-- MI BALANCE 2.0: ejecutar una sola vez en SQL Editor de Supabase.
-- Las tablas financieras son PRIVADAS. Nunca desactives las politicas RLS.

create table if not exists public.mb_households (
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(name) between 1 and 100),
  owner_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create table if not exists public.mb_members (
  household_id uuid not null references public.mb_households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'editor' check (role in ('owner','editor')),
  joined_at timestamptz not null default now(),
  primary key (household_id,user_id)
);
create index if not exists mb_members_user_idx on public.mb_members(user_id);
create table if not exists public.mb_records (
  household_id uuid not null references public.mb_households(id) on delete cascade,
  kind text not null check(kind in ('settings','budget','card','project','tx','planned')),
  record_id text not null check(length(record_id) between 1 and 150),
  data jsonb not null check(jsonb_typeof(data)='object'),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key (household_id,kind,record_id)
);
create index if not exists mb_records_house_idx on public.mb_records(household_id);
create table if not exists public.mb_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.mb_households(id) on delete cascade,
  secret text not null unique,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default(now() + interval '7 days'),
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz
);

-- Funcion de membresia con propietario DEFINER para evitar recursion de RLS.
create or replace function public.mb_is_member(p_household uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.mb_members
    where household_id=p_household and user_id=(select auth.uid()));
$$;
revoke all on function public.mb_is_member(uuid) from public,anon;
grant execute on function public.mb_is_member(uuid) to authenticated;

alter table public.mb_households enable row level security;
alter table public.mb_members enable row level security;
alter table public.mb_records enable row level security;
alter table public.mb_invites enable row level security;

drop policy if exists mb_households_select on public.mb_households;
create policy mb_households_select on public.mb_households for select to authenticated
  using (public.mb_is_member(id));
drop policy if exists mb_members_select on public.mb_members;
create policy mb_members_select on public.mb_members for select to authenticated
  using (public.mb_is_member(household_id));
drop policy if exists mb_records_select on public.mb_records;
create policy mb_records_select on public.mb_records for select to authenticated
  using (public.mb_is_member(household_id));
drop policy if exists mb_records_insert on public.mb_records;
create policy mb_records_insert on public.mb_records for insert to authenticated
  with check (public.mb_is_member(household_id));
drop policy if exists mb_records_update on public.mb_records;
create policy mb_records_update on public.mb_records for update to authenticated
  using (public.mb_is_member(household_id)) with check (public.mb_is_member(household_id));
drop policy if exists mb_records_delete on public.mb_records;
create policy mb_records_delete on public.mb_records for delete to authenticated
  using (public.mb_is_member(household_id));
-- mb_invites no tiene permisos de acceso directo a ninguna cuenta.

-- Crear hogar: inserta el primer usuario como propietario.
create or replace function public.mb_create_household(p_name text)
returns uuid language plpgsql security definer set search_path='' as $$
declare h uuid;
begin
  if (select auth.uid()) is null then raise exception 'Inicia sesion'; end if;
  if length(trim(coalesce(p_name,''))) not between 1 and 100 then raise exception 'Nombre invalido'; end if;
  insert into public.mb_households(name,owner_id) values(trim(p_name),(select auth.uid())) returning id into h;
  insert into public.mb_members(household_id,user_id,role) values(h,(select auth.uid()),'owner');
  return h;
end $$;

-- Solo integrantes pueden crear un codigo de invitacion.
-- Codigo aleatorio de 256 bits, de un solo uso, expira a los 7 dias.
create or replace function public.mb_create_invite(p_household uuid)
returns text language plpgsql security definer set search_path='' as $$
declare t text;
begin
  if (select auth.uid()) is null or not public.mb_is_member(p_household) then
    raise exception 'No tienes permiso';
  end if;
  t := replace(pg_catalog.gen_random_uuid()::text,'-','') || replace(pg_catalog.gen_random_uuid()::text,'-','');
  insert into public.mb_invites(household_id,secret,created_by)
  values(p_household,t,(select auth.uid()));
  return t;
end $$;

-- Unirse: codigo privado valida el ingreso sin revelar otros hogares.
create or replace function public.mb_join_household(p_secret text)
returns uuid language plpgsql security definer set search_path='' as $$
declare h uuid; v_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Inicia sesion'; end if;
  select id,household_id into v_id,h from public.mb_invites
  where secret=trim(coalesce(p_secret,'')) and expires_at>now() and accepted_at is null
  for update;
  if h is null then raise exception 'Codigo invalido, vencido o ya utilizado'; end if;
  insert into public.mb_members(household_id,user_id,role)
    values(h,(select auth.uid()),'editor') on conflict do nothing;
  update public.mb_invites set accepted_by=(select auth.uid()), accepted_at=now() where id=v_id;
  return h;
end $$;

revoke all on function public.mb_create_household(text) from public,anon;
revoke all on function public.mb_create_invite(uuid) from public,anon;
revoke all on function public.mb_join_household(text) from public,anon;
grant execute on function public.mb_create_household(text) to authenticated;
grant execute on function public.mb_create_invite(uuid) to authenticated;
grant execute on function public.mb_join_household(text) to authenticated;
grant usage on schema public to authenticated;
grant select on public.mb_households,public.mb_members to authenticated;
grant select,insert,update,delete on public.mb_records to authenticated;
-- Nada de acceso directo a mb_invites, incluso a usuarios autenticados.
revoke all on public.mb_invites from anon,authenticated;

-- Incluir cambios en el canal Realtime; evita error si ya esta agregado.
do $$ begin
  alter publication supabase_realtime add table public.mb_records;
exception when duplicate_object then null;
end $$;
