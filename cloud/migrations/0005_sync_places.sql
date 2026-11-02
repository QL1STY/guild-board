-- Guild Board online, 0005: the copy of a player's data is limited by a number of places, and a player can see how much room they
-- use (section 5 of the public release plan of 2026-11-02). Applied once, after 0004, as postgres (cloud/README.md).
-- Refusals are `raise exception '<code>' using errcode = 'P0001'`; the core keeps the sentence the player reads for each code.
--
-- Until now the one limit of the project was the total of sync_rows on the disk (0004): once it was passed every player's sync_push
-- was refused, the ones who already had their data in too. Now the number of players who have a copy is limited, so that the total
-- is reached later and only the newcomers are told to wait. Friends and stats are not limited by any of this.
--
-- Every statement here gives the same result when it runs again, so that a run that stopped part of the way can be run again whole.

-- The limits the project's owner changes in the SQL editor (cloud/README.md), now with the three for places and for one player. The
-- defaults are 0004's own limits for a player (20,000 rows, 4 MiB), which were written into sync_push, and 300 places. An existing
-- row gets the defaults, as `add column ... default` fills it.
alter table private.limits add column if not exists sync_seats integer not null default 300;
alter table private.limits add column if not exists player_rows integer not null default 20000;
alter table private.limits add column if not exists player_bytes bigint not null default 4194304;

-- A limit of zero or less would refuse everyone and say nothing of why, so the table refuses it. A check is added once: its name is
-- looked up first, as `add constraint` has no `if not exists`.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'private.limits'::regclass and conname = 'limits_player_fits'
  ) then
    alter table private.limits add constraint limits_player_fits
      check (sync_seats >= 0 and player_rows >= 1 and player_bytes >= 1);
  end if;
end $$;

-- The limits as the functions below read them, one row always: a row of private.limits that was deleted has the defaults, as it had
-- them written in sync_push before. The defaults are written here and nowhere else.
create or replace function private.sync_limits()
returns table (seats integer, player_rows integer, player_bytes bigint)
language sql
stable
set search_path = ''
as $$
  select
    coalesce(l.sync_seats, 300),
    coalesce(l.player_rows, 20000),
    coalesce(l.player_bytes, 4194304::bigint)
  from (select 1) as one
  left join private.limits as l on true
$$;

revoke all on function private.sync_limits() from public, anon, authenticated, service_role;

-- What an account holds, counted in one place for sync_push and for sync_usage, so that the number the player is shown is the
-- number that refuses them. A row is counted as what the table keeps of it: its data, its kind and key twice, as the primary key's
-- index holds them again, its device, and 100 bytes for the row's own header and its two index entries (0004 says why).
create or replace function private.sync_held(p_user uuid)
returns table (rows_held bigint, bytes_held bigint)
language sql
stable
set search_path = ''
as $$
  select
    pg_catalog.count(*),
    coalesce(pg_catalog.sum(
      pg_catalog.pg_column_size(t.data) + 2 * (pg_catalog.octet_length(t.kind) + pg_catalog.octet_length(t.row_key))
      + pg_catalog.octet_length(t.device_id) + 100
    ), 0)::bigint
  from public.sync_rows as t
  where t.user_id = p_user
$$;

revoke all on function private.sync_held(uuid) from public, anon, authenticated, service_role;

-- How many accounts hold a place: those with any row in sync_rows, a deleted row included until it is purged. It steps from one
-- account to the next through the primary key's index (the first row after the last account found), so that it costs one look-up
-- for each account and not a pass over every row, which could be millions. Only the callers below use it, and they tell a player
-- no more than whether a place is free.
create or replace function private.sync_places_taken()
returns bigint
language sql
stable
set search_path = ''
as $$
  with recursive holders (user_id) as (
    (select t.user_id from public.sync_rows as t order by t.user_id limit 1)
    union all
    select (select t.user_id from public.sync_rows as t where t.user_id > h.user_id order by t.user_id limit 1)
    from holders as h
    where h.user_id is not null
  )
  select pg_catalog.count(*) from holders as h where h.user_id is not null
$$;

revoke all on function private.sync_places_taken() from public, anon, authenticated, service_role;

-- 0004's sync_push, with the limits of a player read from private.limits and with the places. What a call is, how its rows are
-- judged, the order of its checks and how the newest edit wins are as 0003 and 0004 say. The one addition to the order is the
-- places, asked right after the project's total and before anything is purged or written.
--
-- A place is held by an account with any row in sync_rows. An account with rows always keeps its place, whatever the places are
-- then: only a call of an account with no rows is asked for one, and is refused with 'sync_seats_full' when the accounts with rows
-- have reached private.limits' sync_seats. Deleting the account (delete_my_account) deletes its rows and so frees the place.
--
-- Two first calls at the limit can both see a free place and both be let in, so the places can pass the limit by one for each
-- call that raced. That is accepted: the limit is a way to keep the project small and not an exact count, and a lock across the
-- project would make every first call wait for every other, and hold one of its connections while it did.
create or replace function public.sync_push(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  me constant uuid := auth.uid();
  this_hour constant timestamptz := pg_catalog.date_trunc('hour', pg_catalog.now(), 'UTC');
  seat_limit integer;
  row_limit integer;
  byte_limit bigint;
  kept integer;
  rows_held bigint;
  bytes_held bigint;
  bytes_brought bigint;
  bytes_counted bigint;
  bytes_this_hour bigint;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if p_rows is null or pg_catalog.jsonb_typeof(p_rows) <> 'array' then
    raise exception 'bad_rows' using errcode = 'P0001';
  end if;
  if pg_catalog.jsonb_array_length(p_rows) = 0 then
    return 0;
  end if;
  if pg_catalog.jsonb_array_length(p_rows) > 500 then
    raise exception 'too_many_rows' using errcode = 'P0001';
  end if;
  select k.seats, k.player_rows, k.player_bytes into seat_limit, row_limit, byte_limit from private.sync_limits() as k;
  bytes_brought := pg_catalog.pg_column_size(p_rows);
  if bytes_brought > byte_limit then
    raise exception 'sync_full' using errcode = 'P0001';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_to_recordset(p_rows)
      as n(kind text, row_key text, data jsonb, deleted boolean, edited_at timestamptz, device_id text)
    where n.kind is null or n.row_key is null or n.edited_at is null or n.device_id is null
      or pg_catalog.char_length(n.kind) not between 1 and 40
      or pg_catalog.char_length(n.row_key) not between 1 and 200
      or pg_catalog.char_length(n.device_id) not between 1 and 64
      or (
        n.deleted is not true and (
          n.data is null or pg_catalog.jsonb_typeof(n.data) <> 'object' or pg_catalog.pg_column_size(n.data) > 262144
        )
      )
  ) then
    raise exception 'bad_rows' using errcode = 'P0001';
  end if;
  -- Held, so that delete_my_account cannot take the profile between here and the foreign key's look at it.
  perform 1 from public.profiles as p where p.user_id = me for key share;
  if not found then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(me::text, 0)) then
    raise exception 'sync_busy' using errcode = 'P0001';
  end if;
  if pg_catalog.pg_total_relation_size('public.sync_rows'::pg_catalog.regclass) + bytes_brought
     > (select l.sync_total_bytes from private.limits as l) then
    raise exception 'sync_full' using errcode = 'P0001', detail = 'project_full';
  end if;
  -- The places. An account that has a row keeps its place, so only one with none is asked for one.
  if not exists (select 1 from public.sync_rows as t where t.user_id = me)
     and private.sync_places_taken() >= seat_limit then
    raise exception 'sync_seats_full' using errcode = 'P0001';
  end if;
  delete from public.sync_rows as t
  where t.user_id = me and t.deleted and t.received_at < pg_catalog.now() - interval '90 days';
  select h.rows_held, h.bytes_held into rows_held, bytes_held from private.sync_held(me) as h;
  if rows_held + pg_catalog.jsonb_array_length(p_rows) > row_limit or bytes_held + bytes_brought > byte_limit then
    raise exception 'sync_full' using errcode = 'P0001';
  end if;
  bytes_counted := greatest(bytes_brought, 16384);
  select coalesce(pg_catalog.sum(l.bytes), 0) into bytes_this_hour
  from private.push_log as l
  where l.user_id = me and l.hour = this_hour;
  if bytes_this_hour + bytes_counted > 16777216 then
    raise exception 'sync_busy' using errcode = 'P0001';
  end if;
  insert into private.push_log as l (user_id, hour, bytes)
  values (me, this_hour, bytes_this_hour + bytes_counted)
  on conflict (user_id) do update set hour = excluded.hour, bytes = excluded.bytes;
  insert into public.sync_rows as s (user_id, kind, row_key, data, deleted, edited_at, device_id)
  select me, r.kind, r.row_key, case when r.deleted then '{}'::jsonb else r.data end, r.deleted, r.edited_at, r.device_id
  from (
    select distinct on (n.kind, n.row_key)
      n.kind,
      n.row_key,
      n.data,
      coalesce(n.deleted, false) as deleted,
      case
        when n.edited_at > pg_catalog.now() + interval '5 minutes' then pg_catalog.now() + interval '5 minutes'
        else n.edited_at
      end as edited_at,
      n.device_id
    from pg_catalog.jsonb_to_recordset(p_rows)
      as n(kind text, row_key text, data jsonb, deleted boolean, edited_at timestamptz, device_id text)
    order by n.kind, n.row_key, n.edited_at desc
  ) as r
  on conflict (user_id, kind, row_key) do update
  set data = excluded.data, deleted = excluded.deleted, edited_at = excluded.edited_at, device_id = excluded.device_id
  where excluded.edited_at >= s.edited_at;
  get diagnostics kept = row_count;
  return kept;
end
$$;

revoke all on function public.sync_push(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.sync_push(jsonb) to authenticated;

-- What the player sees of their room: their own rows and bytes against the limits of a player, counted as sync_push counts them
-- (private.sync_held), and whether a copy of their data has a place. has_place is true for an account that holds rows or when a
-- place is free; seats_full is true when no place is free, whoever asks. Nothing here tells of any other player: no count of them,
-- no name, only whether the places are taken. Read by the core after a sync, and not on a timer.
create or replace function public.sync_usage()
returns table (
  rows_held bigint, rows_limit integer, bytes_held bigint, bytes_limit bigint, has_place boolean, seats_full boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me constant uuid := auth.uid();
  limits record;
  held record;
  place_free boolean;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  select k.seats, k.player_rows, k.player_bytes into strict limits from private.sync_limits() as k;
  select h.rows_held, h.bytes_held into strict held from private.sync_held(me) as h;
  place_free := private.sync_places_taken() < limits.seats;
  return query select held.rows_held, limits.player_rows, held.bytes_held, limits.player_bytes, held.rows_held > 0 or place_free, not place_free;
end
$$;

revoke all on function public.sync_usage() from public, anon, authenticated, service_role;
grant execute on function public.sync_usage() to authenticated;
