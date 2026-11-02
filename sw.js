// Solo se almacena la interfaz; nunca se cachean respuestas de base de datos.
const CACHE='mi-balance-shared-v2-1';
const ASSETS=['./','./index.html','./config.js','./cloud.js','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==self.location.origin)return;
  // config.js e index.html siempre validan en red para recibir actualizaciones.
  if(['index.html','config.js',''].includes(u.pathname.split('/').pop())){
    e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));return;
  }
  e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request)));
});
