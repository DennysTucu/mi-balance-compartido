/* Sincronización por registro independiente: dos usuarios pueden crear gastos
   simultáneamente sin sobrescribir las demás operaciones. No guarda claves secretas. */
'use strict';
class MiBalanceCloud {
  constructor(config, hooks) {
    this.config=config; this.hooks=hooks; this.client=null;this.user=null;
    this.household=null;this.householdName='';this.queue=[];this.shadow=null;
    this.flushing=false;this.loading=false;this.reloadTimer=null;this.realtime=null;
  }
  event(kind,payload){const h=this.hooks[kind];if(h)h(payload)}
  status(label){this.event('status',{label,pending:this.queue.length})}
  queueKey(){return 'mi-balance-cola-v2-'+this.household+'-'+this.user?.id}
  persistQueue(){localStorage.setItem(this.queueKey(),JSON.stringify(this.queue))}
  async initialize(){
    if(!window.supabase?.createClient)throw Error('No se pudo cargar la librería de Supabase. Revisa la conexión a internet.');
    this.client=window.supabase.createClient(this.config.url,this.config.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    const {data,error}=await this.client.auth.getSession();if(error)throw error;
    if(!data.session){this.event('phase','auth');return}
    this.user=data.session.user;await this.findHousehold();
  }
  async signup(email,password){const {data,error}=await this.client.auth.signUp({email,password,options:{emailRedirectTo:location.origin+location.pathname}});if(error)throw error;
    if(data.session){this.user=data.session.user;await this.findHousehold();return 'Cuenta creada e iniciada.'}
    return 'Revisa tu correo y confirma la cuenta. Después, ingresa con tu contraseña.'}
  async signin(email,password){const {data,error}=await this.client.auth.signInWithPassword({email,password});if(error)throw error;
    this.user=data.user;await this.findHousehold();}
  async signout(){if(this.realtime)this.client.removeChannel(this.realtime);this.realtime=null;
    const {error}=await this.client.auth.signOut();if(error)throw error;
    this.user=null;this.household=null;this.queue=[];this.shadow=null;this.event('phase','auth')}
  async findHousehold(){this.event('phase','loading');const {data,error}=await this.client.from('mb_members').select('household_id').eq('user_id',this.user.id).limit(1);
    if(error)throw error;if(!data?.length){this.event('phase','household');return}await this.openHousehold(data[0].household_id)}
  async createHousehold(name){const {data,error}=await this.client.rpc('mb_create_household',{p_name:name});if(error)throw error;
    this.household=data;const sample={id:'card-principal',name:'Tarjeta principal',opening:0,cut:15,pay:5};
    const {error:writeError}=await this.client.from('mb_records').upsert({household_id:data,kind:'card',record_id:sample.id,data:sample},{onConflict:'household_id,kind,record_id'});
    if(writeError)throw writeError;await this.openHousehold(data)}
  async joinHousehold(token){const {data,error}=await this.client.rpc('mb_join_household',{p_secret:token.trim()});if(error)throw error;await this.openHousehold(data)}
  async openHousehold(id){this.household=id;
    const {data,error}=await this.client.from('mb_households').select('name').eq('id',id).single();if(error)throw error;
    this.householdName=data.name;
    try {this.queue=JSON.parse(localStorage.getItem(this.queueKey())||'[]');if(!Array.isArray(this.queue))this.queue=[]}catch{this.queue=[]}
    await this.pull();
    if(this.realtime)this.client.removeChannel(this.realtime);
    this.realtime=this.client.channel('mb-'+id).on('postgres_changes',{event:'*',schema:'public',table:'mb_records',filter:'household_id=eq.'+id},()=>this.schedulePull()).subscribe();
    this.event('phase','ready');this.status(this.queue.length?'Cambios pendientes':'Sincronizado');void this.flush();
  }
  schedulePull(){if(this.reloadTimer)clearTimeout(this.reloadTimer);this.reloadTimer=setTimeout(()=>{this.reloadTimer=null;void this.pull().catch(err=>this.status('Error al actualizar: '+err.message))},500)}
  static encode(d){const rows=new Map();
    const put=(kind,id,data)=>rows.set(kind+'\u001f'+id,{kind,record_id:id,data:JSON.parse(JSON.stringify(data))});
    put('settings','general',d.settings);
    for(const [k,v] of Object.entries(d.budgets||{}))put('budget',k,{limit:v});
    for(const c of d.cards||[])put('card',c.id,c);
    for(const p of d.projects||[])put('project',p.id,p);
    for(const t of d.tx||[])put('tx',t.id,t);
    for(const x of d.planned||[])put('planned',x.id,x);
    return rows;
  }
  static decode(rows){const d={version:1,settings:{salary:0,savingGoal:0,openingCash:0,openingSavings:0,salaryPayDay:0},cards:[],budgets:{},projects:[],tx:[],planned:[]};
    for(const r of rows){const a=r.data;switch(r.kind){
      case 'settings':d.settings={...d.settings,...a};break;
      case 'budget':d.budgets[r.record_id]=Number(a.limit)||0;break;
      case 'card':d.cards.push(a);break;
      case 'project':d.projects.push(a);break;
      case 'tx':d.tx.push(a);break;
      case 'planned':d.planned.push(a);break;
    }}
    const cats=['Alimentación','Agua','Electricidad','Internet','Telefonía','Gas','Vivienda','Transporte','Medicina y salud','Educación','Hogar y limpieza','Entretenimiento','Seguros','Imprevistos','Otros'];
    for(const k of cats)if(!(k in d.budgets))d.budgets[k]=0;
    if(!d.cards.length)d.cards=[{id:'card-principal',name:'Tarjeta principal',opening:0,cut:15,pay:5}];
    return d;
  }
  async fetchRows(){const out=[];for(let start=0;;start+=1000){
    const {data,error}=await this.client.from('mb_records').select('kind,record_id,data').eq('household_id',this.household).order('kind').order('record_id').range(start,start+999);
    if(error)throw error;out.push(...(data||[]));if(!data||data.length<1000)break;
  }return out}
  async pull(){if(this.loading||!this.household)return;this.loading=true;
    try{const rows=await this.fetchRows(),m=new Map(rows.map(r=>[r.kind+'\u001f'+r.record_id,r]));
      for(const op of this.queue){const key=op.kind+'\u001f'+op.record_id;
        if(op.action==='delete')m.delete(key);else m.set(key,{kind:op.kind,record_id:op.record_id,data:op.data})}
      const d=MiBalanceCloud.decode([...m.values()]);this.shadow=JSON.parse(JSON.stringify(d));this.event('data',d);
    }finally{this.loading=false}}
  save(d){if(!this.household||!this.shadow)throw Error('No hay una sesión sincronizada');
    const prev=MiBalanceCloud.encode(this.shadow), next=MiBalanceCloud.encode(d);
    for(const [key,old] of prev){if(!next.has(key))this.queue.push({action:'delete',kind:old.kind,record_id:old.record_id})}
    for(const [key,n] of next){const old=prev.get(key);if(!old||JSON.stringify(old.data)!==JSON.stringify(n.data))this.queue.push({action:'upsert',...n})}
    this.shadow=JSON.parse(JSON.stringify(d));this.persistQueue();this.status('Guardado en este equipo; sincronizando');void this.flush();
  }
  async flush(){if(this.flushing||!this.household||!this.user)return;this.flushing=true;
    try {while(this.queue.length){const op=this.queue[0];let error=null;
      if(op.action==='delete')({error}=await this.client.from('mb_records').delete().eq('household_id',this.household).eq('kind',op.kind).eq('record_id',op.record_id));
      else ({error}=await this.client.from('mb_records').upsert({household_id:this.household,kind:op.kind,record_id:op.record_id,data:op.data,updated_at:new Date().toISOString(),updated_by:this.user.id},{onConflict:'household_id,kind,record_id'}));
      if(error)throw error;
      this.queue.shift();this.persistQueue();this.status(this.queue.length?'Sincronizando':'Sincronizado');
    }}catch(e){this.status('Pendiente: no se pudo conectar. Reintenta al tener internet.');this.event('error',e)}finally{this.flushing=false}}
  async newInvite(){const {data,error}=await this.client.rpc('mb_create_invite',{p_household:this.household});if(error)throw error;return data}
  async importBackup(d){if(this.queue.length)throw Error('Espera a que finalice la sincronización actual');
    const orig=await this.fetchRows();if(orig.some(r=>r.kind==='tx'||r.kind==='project'||r.kind==='planned'||(r.kind==='card'&&r.record_id!=='card-principal')))
      throw Error('El hogar ya contiene movimientos o proyectos. Para evitar duplicados, importa solo en un hogar nuevo.');
    const fixed={...d,planned:Array.isArray(d.planned)?d.planned:[],settings:{...d.settings,salaryPayDay:Number(d.settings.salaryPayDay)||0}};
    const rows=[...MiBalanceCloud.encode(fixed).values()].map(r=>({...r,household_id:this.household,updated_by:this.user.id}));
    for(let start=0;start<rows.length;start+=100){const {error}=await this.client.from('mb_records').upsert(rows.slice(start,start+100),{onConflict:'household_id,kind,record_id'});if(error)throw error}
    await this.pull();this.status('Respaldo importado a la nube');
  }
}
window.MiBalanceCloud=MiBalanceCloud;
