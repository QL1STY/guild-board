-- Guild Board online, 0003: sync. The player's own data, copied to their account (the online design, section 8).
-- Applied once, after 0002, as postgres (cloud/README.md). Refusals are `raise exception '<code>' using errcode = 'P0001'`;
-- the core keeps the sentence the player reads for each code.

-- One row for each row of the player's own data: its kind (the table it is in on a PC), its key (the same on every PC), what
-- it holds, and when it was last edited. A delete is a row too, `deleted`, so that it reaches the other PCs.
create table public.sync_rows (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  kind text not null,
  row_key text not null,
  data jsonb not null,
  deleted boolean not null default false,
  edited_at timestamptz not null,
  received_at timestamptz not null default now(),
  device_id text not null,
  primary key (user_id, kind, row_key),
  constraint sync_rows_kind_fits check (char_length(kind) between 1 and 40),
  constraint sync_rows_key_fits check (char_length(row_key) between 1 and 200),
  constraint sync_rows_device_fits check (char_length(device_id) between 1 and 64),
  constraint sync_rows_data_is_an_object check (jsonb_typeof(data) = 'object'),
  constraint sync_rows_data_fits check (pg_column_size(data) <= 262144)
);

-- What a PC asks for: the rows that came after the last it read.
create index sync_rows_user_id_received_at on public.sync_rows (user_id, received_at);

alter table public.sync_rows enable row level security;

revoke all on table public.sync_rows from public, anon, authenticated, service_role;

-- The rows change through sync_push alone, which keeps what a player holds within its limits before it writes anything: this is
-- the one table a client can grow by itself, and a free project stops taking writes for everyone at 500 MB.
grant select on table public.sync_rows to authenticated;

create policy sync_rows_select on public.sync_rows
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- What each player has written this hour, for the limit of sync_push. One row for each player: the count of an hour that is over
-- says nothing, and the next call starts over.
create table private.push_log (
  user_id uuid primary key references public.profiles (user_id) on delete cascade,
  hour timestamptz not null,
  bytes bigint not null
);

revoke all on table private.push_log from public, anon, authenticated, service_role;

-- What keeps a row's arrival the server's: a PC reads the rows that came after the last it saw, by this time. A trigger's
-- function needs no grant to run.
create function private.stamp_received_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.received_at := pg_catalog.now();
  return new;
end
$$;

create trigger sync_rows_stamped
  before insert or update on public.sync_rows
  for each row execute function private.stamp_received_at();

revoke all on function private.stamp_received_at() from public, anon, authenticated, service_role;

-- A PC's changes: a JSON array of rows, each with `kind`, `row_key`, `data`, `deleted`, `edited_at` and `device_id`. How many
-- of them were kept.
--
-- The newest edit wins, row by row, by edited_at, so that a PC that was offline cannot lay an older edit over a later one. A
-- tie goes to the one that arrives later. An edit older than the row is not kept, and the count says so. An edited_at more than
-- five minutes ahead of the server is kept as five minutes ahead, so that a PC whose clock is wrong can win for those minutes
-- and not for a year. Two rows of one key in a call are one: the newer. A call holds at most 500 rows: a read gives 1,000, so
-- the rows one call wrote can never fill a read, and a read that goes by received_at can always move on.
--
-- A deleted row keeps no data. Deleted rows go once they are 90 days old (by their arrival, so that every PC has had that long
-- to read them), on the next call, and before the rows are counted, so that an old delete cannot hold a player at the limit.
--
-- The disk counts rows that are gone until a vacuum: a call that fails after writing leaves its bulk, and so does one row overwritten
-- again and again. So nothing is written until nothing can refuse it. Every row is judged first, by all the table's constraints would
-- ask, 'bad_rows', and the player's profile is held, as the foreign key would look for it only after the rows are written.
--
-- A player holds at most 50,000 rows and 16 MiB, keys included, and writes at most 16 MiB in an hour: the real player's 1,896 rows and
-- about 500 KB of 2026-11-01 are a 26th of the one and a 32nd of the other, and a first sync of them is about that too. A call counts
-- all its rows and the size of all it brings. Past what the account holds it is refused with 'sync_full', past the hour's bytes with
-- 'sync_busy', which ends by itself. The lock makes one player's calls wait for each other, so that they cannot find the same room. The hour is an hour
-- of UTC: date_trunc goes by the session's zone otherwise, which a client sets with Prefer: timezone, and in a zone half an hour off
-- each call would start the count over.
--
-- This runs with the owner's rights, so no policy guards it: every statement here names `me`, and nothing in the rows says whose
-- they are.
create function public.sync_push(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  me constant uuid := auth.uid();
  this_hour constant timestamptz := pg_catalog.date_trunc('hour', pg_catalog.now(), 'UTC');
  kept integer;
  rows_held bigint;
  bytes_held bigint;
  bytes_brought bigint;
  bytes_this_hour bigint;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if p_rows is null or pg_catalog.jsonb_typeof(p_rows) <> 'array' then
    raise exception 'bad_rows' using errcode = 'P0001';
  end if;
  if pg_catalog.jsonb_array_length(p_rows) > 500 then
    raise exception 'too_many_rows' using errcode = 'P0001';
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
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(me::text, 0));
  delete from public.sync_rows as t
  where t.user_id = me and t.deleted and t.received_at < pg_catalog.now() - interval '90 days';
  bytes_brought := pg_catalog.pg_column_size(p_rows);
  select
    pg_catalog.count(*),
    coalesce(pg_catalog.sum(
      pg_catalog.pg_column_size(t.data) + pg_catalog.octet_length(t.kind) + pg_catalog.octet_length(t.row_key)
      + pg_catalog.octet_length(t.device_id)
    ), 0)
  into rows_held, bytes_held
  from public.sync_rows as t
  where t.user_id = me;
  if rows_held + pg_catalog.jsonb_array_length(p_rows) > 50000 or bytes_held + bytes_brought > 16777216 then
    raise exception 'sync_full' using errcode = 'P0001';
  end if;
  select coalesce(pg_catalog.sum(l.bytes), 0) into bytes_this_hour
  from private.push_log as l
  where l.user_id = me and l.hour = this_hour;
  if bytes_this_hour + bytes_brought > 16777216 then
    raise exception 'sync_busy' using errcode = 'P0001';
  end if;
  insert into private.push_log as l (user_id, hour, bytes)
  values (me, this_hour, bytes_this_hour + bytes_brought)
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

-- The project's advisor flagged the log of requests (0002) for having no primary key.
alter table private.request_log add column id bigint generated always as identity primary key;

-- A shared stat of 0002's 4,096 bytes goes to TOAST, and uploads over and over grow the disk more than four times as fast as they do
-- at this limit. The largest stat there is, six months of primogems, takes under 400 bytes.
alter table public.shared_stats drop constraint shared_stats_value_fits;
alter table public.shared_stats add constraint shared_stats_value_fits check (pg_column_size(value) <= 1024);

-- When a stat last changed would tell a friend that the PC was on, with Status off, so a client reads what it says and not that.
revoke select on table public.shared_stats from authenticated;
grant select (user_id, key, value) on table public.shared_stats to authenticated;
