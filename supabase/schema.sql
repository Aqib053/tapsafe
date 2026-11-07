-- TapSafe schema. Schema only, no data.
-- Run in the Supabase SQL editor. Safe to read; contains no secrets.
--
-- Access model:
--   * Driver logs in with Supabase Auth (phone + PIN as password).
--   * Parents never log in. They only get Telegram messages.
--   * Edge Functions use the service role key, which bypasses RLS.
--   * anon role gets nothing. Parent phone and telegram_chat_id are never
--     readable from the app.

-- ---------------------------------------------------------------- tables

create table public.drivers (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  name         text not null,
  phone        text not null unique,
  van_number   text not null
);

create table public.parents (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  phone            text not null,
  telegram_chat_id bigint
);

create table public.children (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  parent_id  uuid not null references public.parents (id),
  driver_id  uuid not null references public.drivers (id),
  stop       text not null,
  drop_order int  not null
);

create table public.trips (
  id         uuid primary key default gen_random_uuid(),
  driver_id  uuid not null references public.drivers (id),
  start_time timestamptz not null default now(),
  end_time   timestamptz,
  status     text not null default 'active'
             check (status in ('active', 'completed'))
);

create table public.events (
  id       uuid primary key default gen_random_uuid(),
  trip_id  uuid not null references public.trips (id),
  child_id uuid not null references public.children (id),
  type     text not null check (type in ('boarded', 'dropped', 'absent')),
  time     timestamptz not null default now(),
  -- set by check_overdue on the boarded row, so each child is reminded once
  overdue_notified_at timestamptz,
  -- a retried offline tap must not create a duplicate event
  unique (trip_id, child_id, type)
);

create index children_driver_idx on public.children (driver_id, drop_order);
create index trips_driver_idx    on public.trips (driver_id);
create index events_trip_idx     on public.events (trip_id);

-- one active trip per driver
create unique index trips_one_active_per_driver
  on public.trips (driver_id) where status = 'active';

-- ------------------------------------------------------------ RLS: on everywhere

alter table public.drivers  enable row level security;
alter table public.parents  enable row level security;
alter table public.children enable row level security;
alter table public.trips    enable row level security;
alter table public.events   enable row level security;

-- ------------------------------------------------------------ privileges
-- Start from nothing, then grant only what the driver app needs.

revoke all on public.drivers, public.parents, public.children,
              public.trips,   public.events
  from anon, authenticated;

grant select on public.drivers, public.children, public.trips, public.events
  to authenticated;
-- Column-level: the app can set only these. start_time and driver_id on
-- update stay fixed, so the overdue clock can't be moved.
grant insert (driver_id)           on public.trips to authenticated;
grant update (status, end_time)    on public.trips to authenticated;
-- No grant on parents for anyone. Only the service role reads it.
-- No insert on events: the mark_event Edge Function writes events.

-- ------------------------------------------------------------ helper
-- Maps the logged-in auth user to their drivers row.

create or replace function public.current_driver_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.drivers where auth_user_id = (select auth.uid())
$$;

revoke execute on function public.current_driver_id() from public, anon;
grant  execute on function public.current_driver_id() to authenticated;

-- ------------------------------------------------------------ rule 2: End Trip
-- A trip can end only when every child on the van has a `dropped` or
-- `absent` event in it. Enforced here so no client can skip it.

create or replace function public.guard_trip_end()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'completed' then
    raise exception 'Trip already ended';
  end if;

  if new.status = 'completed' then
    if exists (
      select 1 from public.children c
      where c.driver_id = new.driver_id
        and not exists (
          select 1 from public.events e
          where e.trip_id = new.id
            and e.child_id = c.id
            and e.type in ('dropped', 'absent')
        )
    ) then
      raise exception 'Some children are not dropped or marked absent';
    end if;
    new.end_time := now();
  end if;

  return new;
end;
$$;

create trigger trips_guard_end
  before update on public.trips
  for each row execute function public.guard_trip_end();

-- ------------------------------------------------------------ policies

-- drivers: a driver sees only their own row
create policy drivers_select_own on public.drivers
  for select to authenticated
  using (id = public.current_driver_id());

-- parents: no policy. RLS on + no policy = no access except service role.

-- children: a driver sees only their van's list
create policy children_select_own on public.children
  for select to authenticated
  using (driver_id = public.current_driver_id());

-- trips: own trips only
create policy trips_select_own on public.trips
  for select to authenticated
  using (driver_id = public.current_driver_id());

create policy trips_insert_own on public.trips
  for insert to authenticated
  with check (
    driver_id = public.current_driver_id()
    and status = 'active'
  );

create policy trips_update_own on public.trips
  for update to authenticated
  using      (driver_id = public.current_driver_id())
  with check (driver_id = public.current_driver_id());

-- events: read events of own trips. Writes go through Edge Functions.
create policy events_select_own on public.events
  for select to authenticated
  using (
    exists (
      select 1 from public.trips t
      where t.id = events.trip_id
        and t.driver_id = public.current_driver_id()
    )
  );
