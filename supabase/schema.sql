-- FORGE AI schema (Supabase Free). Run once in the SQL editor of a fresh project.
--
-- Security model
--   * Every table with user data has user_id and row-level security limited to the owner.
--   * The app reads and writes user data through the signed-in user's session, so these
--     policies, not app code, are what keep users apart.
--   * daily_usage is read-only for its owner. Only claim_live_mission() and the server's
--     service-role key can write to it, so nobody can reset their own quota.
--   * The anon role (logged-out visitors) gets no table access at all.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

-- The user's AI partner (the "Imprint"). One per user in v1.
create table if not exists public.intelligence_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  personality text not null default '' check (char_length(personality) <= 2000),
  standards text not null default '' check (char_length(standards) <= 6000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.missions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  profile_id uuid not null references public.intelligence_profiles (id) on delete cascade,
  brief text not null check (char_length(brief) <= 8000),
  mode text not null check (mode in ('compact', 'full')),
  provider text not null,
  status text not null default 'running'
    check (status in ('running', 'awaiting_review', 'approved', 'rejected', 'failed')),
  gates jsonb,
  applied_lesson_ids uuid[] not null default '{}',
  feedback text check (char_length(feedback) <= 4000),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists missions_user_idx on public.missions (user_id, created_at desc);

-- One row per specialist per mission. Prompts aren't stored, only results.
create table if not exists public.mission_outputs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mission_id uuid not null references public.missions (id) on delete cascade,
  role text not null check (role in ('architect', 'builder', 'critic', 'witness')),
  content text not null check (char_length(content) <= 60000),
  created_at timestamptz not null default now(),
  unique (mission_id, role)
);

create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  profile_id uuid not null references public.intelligence_profiles (id) on delete cascade,
  mission_id uuid references public.missions (id) on delete set null,
  text text not null check (char_length(text) <= 500),
  source text not null check (source in ('approval', 'correction', 'manual')),
  created_at timestamptz not null default now()
);
create index if not exists lessons_user_idx on public.lessons (user_id, created_at desc);

-- One row per live provider request: the source of truth for quotas and actual usage.
create table if not exists public.daily_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  usage_date date not null default ((now() at time zone 'utc')::date),
  provider text not null,
  request_count int not null default 1,
  input_units int not null default 0,
  output_units int not null default 0,
  mission_id uuid references public.missions (id) on delete set null,
  status text not null default 'reserved' check (status in ('reserved', 'succeeded', 'failed')),
  success boolean,
  ip_hash text not null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists daily_usage_day_idx on public.daily_usage (usage_date);
create index if not exists daily_usage_user_day_idx on public.daily_usage (user_id, usage_date);

-- ---------------------------------------------------------------------------
-- Privileges: logged-out visitors get nothing. Signed-in users get only what RLS allows.
-- ---------------------------------------------------------------------------

revoke all on public.profiles, public.intelligence_profiles, public.missions,
  public.mission_outputs, public.lessons, public.daily_usage from anon;
revoke all on public.profiles, public.intelligence_profiles, public.missions,
  public.mission_outputs, public.lessons, public.daily_usage from authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.intelligence_profiles, public.missions,
  public.mission_outputs, public.lessons to authenticated;
grant select on public.daily_usage to authenticated;

alter table public.profiles enable row level security;
alter table public.intelligence_profiles enable row level security;
alter table public.missions enable row level security;
alter table public.mission_outputs enable row level security;
alter table public.lessons enable row level security;
alter table public.daily_usage enable row level security;

-- ---------------------------------------------------------------------------
-- Policies: owner-only. Child rows must also point at a parent the user owns.
-- ---------------------------------------------------------------------------

drop policy if exists profiles_owner on public.profiles;
create policy profiles_owner on public.profiles
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists intelligence_profiles_owner on public.intelligence_profiles;
create policy intelligence_profiles_owner on public.intelligence_profiles
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists missions_owner on public.missions;
create policy missions_owner on public.missions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.intelligence_profiles p
                where p.id = profile_id and p.user_id = (select auth.uid()))
  );

drop policy if exists mission_outputs_owner on public.mission_outputs;
create policy mission_outputs_owner on public.mission_outputs
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.missions m
                where m.id = mission_id and m.user_id = (select auth.uid()))
  );

drop policy if exists lessons_owner on public.lessons;
create policy lessons_owner on public.lessons
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.intelligence_profiles p
                where p.id = profile_id and p.user_id = (select auth.uid()))
    and (mission_id is null or exists (select 1 from public.missions m
                where m.id = mission_id and m.user_id = (select auth.uid())))
  );

drop policy if exists daily_usage_owner_read on public.daily_usage;
create policy daily_usage_owner_read on public.daily_usage
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- New users get a profile row automatically.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Atomic quota claim. It runs before any live provider request. A transaction-level
-- advisory lock serializes concurrent claims, so two requests can't both take the
-- last slot. Every claimed request counts, including failed ones, so a failure
-- can't be retried for free.
-- Only the server (service role) may call it. Limits come from server env vars.
-- ---------------------------------------------------------------------------

create or replace function public.claim_live_mission(
  p_user_id uuid,
  p_ip_hash text,
  p_provider text,
  p_user_limit int,
  p_ip_limit int,
  p_global_limit int
)
returns table (usage_id uuid, outcome text, user_used int, global_used int)
language plpgsql security definer set search_path = '' as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_user int;
  v_ip int;
  v_global int;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('forge_live_quota'));

  select count(*) into v_global from public.daily_usage where usage_date = v_day;
  select count(*) into v_user from public.daily_usage
    where usage_date = v_day and user_id = p_user_id;
  select count(*) into v_ip from public.daily_usage
    where usage_date = v_day and ip_hash = p_ip_hash;

  if v_global >= p_global_limit then
    return query select null::uuid, 'global_limit'::text, v_user, v_global; return;
  end if;
  if v_user >= p_user_limit then
    return query select null::uuid, 'user_limit'::text, v_user, v_global; return;
  end if;
  if v_ip >= p_ip_limit then
    return query select null::uuid, 'ip_limit'::text, v_user, v_global; return;
  end if;

  insert into public.daily_usage (user_id, usage_date, provider, ip_hash, status)
  values (p_user_id, v_day, p_provider, p_ip_hash, 'reserved')
  returning id into v_id;

  return query select v_id, 'ok'::text, v_user + 1, v_global + 1;
end $$;

revoke all on function public.claim_live_mission(uuid, text, text, int, int, int)
  from public, anon, authenticated;
grant execute on function public.claim_live_mission(uuid, text, text, int, int, int)
  to service_role;
