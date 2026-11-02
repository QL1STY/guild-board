-- Guild Board online, 0004: what the code audit of 2026-11-01 found in the online project (H6, H7, M7, M8, M9 and L6 to L10 of
-- that audit's report). Applied once, after 0003, as postgres (cloud/README.md).
-- Refusals are `raise exception '<code>' using errcode = 'P0001'`; the core keeps the sentence the player reads for each code.
--
-- Every statement here gives the same result when it runs again, so that a run that stopped part of the way can be run again whole.

-- A UID is unique among the players who allow Find me by UID, and only there (H6). Unique across every profile, and written by the
-- player's own update, a UID that was taken refused that update, which told anyone whether a UID had an account, one UID a try and
-- with no limit, whatever its owner allowed. Now a UID that nobody can be found by tells nothing of who holds it, and two players
-- who both hide one can both hold it; whoever allows finding a UID first holds it for finding. The second index serves every other
-- look by UID, such as who holds one.
alter table public.profiles drop constraint if exists profiles_uid_key;
create unique index if not exists profiles_uid_findable on public.profiles (uid) where find_by_uid;
create index if not exists profiles_uid on public.profiles (uid);

-- The UID and its switch change through set_uid alone. The AR and the picture stay the player's to write.
revoke update (uid, find_by_uid) on table public.profiles from authenticated;

-- The player's lookup of this second, used up: true when a second has passed since their last one, which this one then is. Each call
-- whose answer can tell whether a tag or a UID is somebody's asks it first (send_friend_request, set_uid, rename_profile), so that
-- all of them together give at most one such answer a second. A call that raises takes its line back with everything else.
create or replace function private.use_lookup(p_me uuid)
returns boolean
language plpgsql
volatile
set search_path = ''
as $$
begin
  insert into private.lookup_log as last (user_id, at) values (p_me, pg_catalog.now())
  on conflict (user_id) do update set at = excluded.at
  where last.at <= pg_catalog.now() - interval '1 second';
  return found;
end
$$;

revoke all on function private.use_lookup(uuid) from public, anon, authenticated, service_role;

-- The player's UID and whether they can be found by it, in one step; a null UID clears it. A UID has nine or ten digits. Refused
-- within a second of the last lookup, as a lookup is. 'uid_taken' says that another player allows finding this UID, which is what
-- that player allowed to be known, and changes nothing. That raise takes its lookup back, as every refusal of send_friend_request
-- does but its two answers, so only a UID that can be found answers without using up a second.
create or replace function public.set_uid(p_uid bigint, p_find boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me constant uuid := auth.uid();
  broken text;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if p_find is null or p_uid not between 100000000 and 9999999999 then
    raise exception 'invalid_uid' using errcode = 'P0001';
  end if;
  perform 1 from public.profiles as p where p.user_id = me;
  if not found then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if not private.use_lookup(me) then
    raise exception 'lookup_limit' using errcode = 'P0001';
  end if;
  begin
    update public.profiles as p set uid = p_uid, find_by_uid = p_find where p.user_id = me;
  exception when unique_violation then
    get stacked diagnostics broken = constraint_name;
    if broken is distinct from 'profiles_uid_findable' then
      raise;
    end if;
    raise exception 'uid_taken' using errcode = 'P0001';
  end;
end
$$;

revoke all on function public.set_uid(bigint, boolean) from public, anon, authenticated, service_role;
grant execute on function public.set_uid(bigint, boolean) to authenticated;

-- What a client reads of the four tables that row level security opens to it, column by column (H7), as 0003 did for shared_stats.
-- A grant of the whole table lets a client select the system columns too, and a row's xmax changes whenever the server holds the
-- row: each sync_push, stat upload and heartbeat holds the player's profile, so a friend who asked for xmax again and again knew when
-- the PC was on, with Status off. These are every column each table has, so that what a client reads today stays as it is. A revoke
-- of the table takes its column grants with it, which the grant after it gives back. A column that a later migration adds needs a
-- grant of its own.
revoke select on table public.profiles from authenticated;
grant select (user_id, name, discriminator, picture_url, ar, uid, find_by_uid, pins, sharing, created_at)
  on table public.profiles to authenticated;

revoke select on table public.friendships from authenticated;
grant select (user_a, user_b, status, requested_by, created_at) on table public.friendships to authenticated;

revoke select on table public.presence from authenticated;
grant select (user_id, state, since, last_seen) on table public.presence to authenticated;

revoke select on table public.sync_rows from authenticated;
grant select (user_id, kind, row_key, data, deleted, edited_at, received_at, device_id) on table public.sync_rows to authenticated;

-- The limits of the whole project, one row of them, which its owner can change in the SQL editor without a migration (cloud/
-- README.md). sync_total_bytes is how large sync_rows may grow on the disk, its indexes, its TOAST and the room of dead rows included,
-- before every player's sync_push is refused (M7): a free project goes read-only for everyone at 500 MB, and the limits of each
-- player alone let 15 to 30 accounts take it there within an hour. 350 MB leaves the rest to the other tables and to Supabase's own.
-- With no row there is no total.
create table if not exists private.limits (
  id boolean primary key default true,
  sync_total_bytes bigint not null,
  constraint limits_one_row check (id)
);

revoke all on table private.limits from public, anon, authenticated, service_role;

insert into private.limits (sync_total_bytes) values (350000000) on conflict (id) do nothing;

-- 0001's ensure_profile, which now refuses a session that is no sign-in with Discord: an anonymous one, which a project gives when
-- its anonymous sign-ins are on (M7). Such a session could make a profile, and with it use up the project's room, with no account
-- behind it. A session's JWT says whether it is anonymous; one that says nothing is taken as a sign-in.
create or replace function public.ensure_profile(p_name text)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  me constant uuid := auth.uid();
  kept public.profiles;
  candidate text;
begin
  if me is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  select * into kept from public.profiles where user_id = me;
  if found then
    return kept;
  end if;
  if not private.valid_name(p_name) then
    raise exception 'invalid_name' using errcode = 'P0001';
  end if;
  for attempt in 1..5 loop
    candidate := private.free_number(p_name, null, null);
    exit when candidate is null;
    begin
      insert into public.profiles (user_id, name, discriminator)
      values (me, p_name, candidate)
      returning * into kept;
      return kept;
    exception when unique_violation then
      select * into kept from public.profiles where user_id = me;
      if found then
        return kept;
      end if;
    end;
  end loop;
  raise exception 'invalid_name' using errcode = 'P0001';
end
$$;

-- 0003's sync_push, with the limits the audit asked for (M7, M9). What a call is, how its rows are judged and how the newest edit
-- wins are as 0003 says.
--
-- A call of no rows returns 0 at once and does nothing else: the core never sends one, and each did all the work of a call. So the
-- deleted rows that are 90 days old go on the next call that brings rows.
--
-- A player holds at most 20,000 rows and 4 MiB (the player's decision of 2026-11-01, the audit's section 6). A row is counted as
-- what the table keeps of it: its data, its kind and key twice, as the primary key's index holds them again, its device, and 100
-- bytes for the row's own header and its two index entries. The real player's 1,896 rows of 2026-11-01, about 500 KB as 0003
-- counted them, are about 750 KB so, a fifth of 4 MiB. 4 MiB holds about 38,000 of the smallest rows, so 0003's 50,000 could no
-- longer be reached; 20,000 is ten times the real player's. A call that brings more than 4 MiB could never be kept, and is refused
-- before anything of it is read.
--
-- The project as a whole: past private.limits' total, by what sync_rows takes on the disk and what the call brings, every call is
-- refused with 'sync_full', its detail 'project_full' telling it from an account that is full. Only a vacuum full gives back the
-- disk of dead rows (cloud/README.md), so once it is reached it stays until the owner makes room.
--
-- The hour: a call counts as what it brings and at least 16 KiB, so that an hour of a player holds at most 1,024 calls, each of
-- which reads every row they hold; a call of no more than a few bytes counted as those few, and two million of them fitted in an
-- hour. The core sends at most one small call each ten seconds while the player edits, 360 an hour, 6 MiB of the 16. And a player's
-- calls side by side don't wait for each other: one runs, and the others are refused with 'sync_busy' at once, as each waiting call
-- held one of the project's connections.
create or replace function public.sync_push(p_rows jsonb)
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
  bytes_brought := pg_catalog.pg_column_size(p_rows);
  if bytes_brought > 4194304 then
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
  delete from public.sync_rows as t
  where t.user_id = me and t.deleted and t.received_at < pg_catalog.now() - interval '90 days';
  select
    pg_catalog.count(*),
    coalesce(pg_catalog.sum(
      pg_catalog.pg_column_size(t.data) + 2 * (pg_catalog.octet_length(t.kind) + pg_catalog.octet_length(t.row_key))
      + pg_catalog.octet_length(t.device_id) + 100
    ), 0)
  into rows_held, bytes_held
  from public.sync_rows as t
  where t.user_id = me;
  if rows_held + pg_catalog.jsonb_array_length(p_rows) > 20000 or bytes_held + bytes_brought > 4194304 then
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

-- Who declined whom, for 30 days (M8). A decline deleted the request and nothing else, so the same player could ask again at once,
-- 20 times a day, renamed each time if they liked, and the one they asked had no way to stop it. A decline still deletes the
-- request, so it leaves the asker's Outgoing list as it did; and now, for 30 days, a request of theirs to that player, by tag, by UID
-- or by invite, gets the answer of a request still waiting, 'already_sent', and sends nothing. The one who declined can still ask
-- them, and asking lifts the decline.
create table if not exists private.declines (
  asker uuid not null references public.profiles (user_id) on delete cascade,
  asked uuid not null references public.profiles (user_id) on delete cascade,
  at timestamptz not null default now(),
  primary key (asker, asked)
);

create index if not exists declines_asked on private.declines (asked);

revoke all on table private.declines from public, anon, authenticated, service_role;

-- 0002's request_friend, with three more rules (M8). A request waits 30 days for its answer, and after that it is as if it had never
-- been sent: nobody is shown it, it can't be answered, it is none of the 50 below, and a request between the same two players
-- replaces it. Only that row goes here, the one of the two players the call is about, as the call writes nobody else's. A player who
-- was declined is answered as above. And at most 50 requests wait for one player: past that a new one is refused with
-- 'incoming_full', so that requests can't pile up for a player faster than they can decline them.
create or replace function private.request_friend(p_me uuid, p_them uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  low constant uuid := least(p_me, p_them);
  high constant uuid := greatest(p_me, p_them);
  kept public.friendships;
begin
  delete from public.friendships as f
  where f.user_a = low and f.user_b = high and f.status = 'pending' and f.created_at <= pg_catalog.now() - interval '30 days';
  select * into kept from public.friendships as f where f.user_a = low and f.user_b = high for update;
  if found then
    if kept.status = 'accepted' then
      raise exception 'already_friends' using errcode = 'P0001';
    end if;
    if kept.requested_by = p_me then
      raise exception 'already_sent' using errcode = 'P0001';
    end if;
    if private.friend_count(p_me) >= 200 or private.friend_count(p_them) >= 200 then
      raise exception 'friend_limit' using errcode = 'P0001';
    end if;
    update public.friendships as f set status = 'accepted' where f.user_a = low and f.user_b = high;
    return 'accepted';
  end if;
  if exists (
    select 1 from private.declines as d
    where d.asker = p_me and d.asked = p_them and d.at > pg_catalog.now() - interval '30 days'
  ) then
    raise exception 'already_sent' using errcode = 'P0001';
  end if;
  if private.friend_count(p_me) >= 200 then
    raise exception 'friend_limit' using errcode = 'P0001';
  end if;
  if (
    select pg_catalog.count(*) from public.friendships as f
    where f.status = 'pending' and f.requested_by <> p_them and p_them in (f.user_a, f.user_b)
      and f.created_at > pg_catalog.now() - interval '30 days'
  ) >= 50 then
    raise exception 'incoming_full' using errcode = 'P0001';
  end if;
  -- Asking a player one had declined lifts that decline: the asker chose so.
  delete from private.declines as d where d.asker = p_them and d.asked = p_me;
  -- The other's request can come at this very moment: the row is theirs then, and this one was sent after it.
  insert into public.friendships (user_a, user_b, requested_by) values (low, high, p_me) on conflict do nothing;
  if not found then
    raise exception 'already_sent' using errcode = 'P0001';
  end if;
  delete from private.request_log as l where l.user_id = p_me and l.at <= pg_catalog.now() - interval '1 day';
  insert into private.request_log (user_id) values (p_me);
  return 'sent';
end
$$;

-- 0002's answer_friend_request. A request a month old is no longer waiting, and a decline is kept for 30 days; the player's
-- declines older than that go then, so that the table holds about a month of each player's.
create or replace function public.answer_friend_request(p_user uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me constant uuid := auth.uid();
  low constant uuid := least(me, p_user);
  high constant uuid := greatest(me, p_user);
  kept public.friendships;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  select * into kept from public.friendships as f where f.user_a = low and f.user_b = high for update;
  if not found or kept.status <> 'pending' or kept.created_at <= pg_catalog.now() - interval '30 days'
     or kept.requested_by = me or p_accept is null then
    raise exception 'no_such_request' using errcode = 'P0001';
  end if;
  if not p_accept then
    delete from public.friendships as f where f.user_a = low and f.user_b = high;
    delete from private.declines as d where d.asked = me and d.at <= pg_catalog.now() - interval '30 days';
    insert into private.declines as d (asker, asked) values (p_user, me)
    on conflict (asker, asked) do update set at = excluded.at;
    return;
  end if;
  if private.friend_count(me) >= 200 or private.friend_count(p_user) >= 200 then
    raise exception 'friend_limit' using errcode = 'P0001';
  end if;
  update public.friendships as f set status = 'accepted' where f.user_a = low and f.user_b = high;
end
$$;

-- 0002's pending_cards, without the requests that are a month old.
create or replace function private.pending_cards()
returns table (direction text, user_id uuid, name text, tag text, has_picture boolean, ar smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case when f.requested_by = me.id then 'outgoing' else 'incoming' end,
    them.user_id,
    them.name,
    them.discriminator,
    them.picture_url is not null,
    them.ar
  from (select auth.uid() as id) as me
  join public.friendships as f
    on f.status = 'pending' and me.id in (f.user_a, f.user_b) and f.created_at > pg_catalog.now() - interval '30 days'
  join public.profiles as them on them.user_id = case when f.user_a = me.id then f.user_b else f.user_a end
  order by f.created_at, them.user_id
$$;

-- 0002's send_friend_request, which refuses a player of 200 friends before the search, next to the limit of requests (L6). For them
-- every match was refused with 'friend_limit' after the search, and a raise takes the call back, its lookup with it, while a miss was
-- the answer 'no_such_tag' or 'no_such_uid': they could test tags and UIDs as fast as they liked, as many as they had sockpuppets
-- for. The rest is as 0002 says, its two answers that are no raise above all. The lookup's second is private.use_lookup's now.
create or replace function public.send_friend_request(p_query text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me constant uuid := auth.uid();
  wanted constant text := pg_catalog.btrim(coalesce(p_query, ''));
  tag text[];
  them uuid;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if not private.use_lookup(me) then
    raise exception 'lookup_limit' using errcode = 'P0001';
  end if;
  if not private.request_allowed(me) then
    raise exception 'request_limit' using errcode = 'P0001';
  end if;
  if private.friend_count(me) >= 200 then
    raise exception 'friend_limit' using errcode = 'P0001';
  end if;
  if wanted ~ '^[0-9]+$' then
    if pg_catalog.char_length(wanted) <= 18 then  -- past that it is no bigint, and no UID
      select p.user_id into them from public.profiles as p where p.uid = wanted::bigint and p.find_by_uid;
    end if;
    if them is null then
      return 'no_such_uid';
    end if;
  else
    tag := pg_catalog.regexp_match(wanted, '^(.+)#([0-9]{4})$');
    if tag is not null then
      select p.user_id into them
      from public.profiles as p
      where pg_catalog.lower(p.name) = pg_catalog.lower(tag[1]) and p.discriminator = tag[2];
    end if;
    if them is null then
      return 'no_such_tag';
    end if;
  end if;
  if them = me then
    raise exception 'own_tag' using errcode = 'P0001';
  end if;
  return private.request_friend(me, them);
end
$$;

-- 0001's rename_profile, which counts as a lookup (L7). A player's number stays when it is free under the new name, so a number that
-- changed after a rename to N said that N#<the old number> existed: a lookup with no request sent and no limit, each of which also
-- looked through 9,999 numbers. A name that is refused is refused before, and uses up nothing.
create or replace function public.rename_profile(p_name text)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  me constant uuid := auth.uid();
  kept public.profiles;
  candidate text;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if not private.valid_name(p_name) then
    raise exception 'invalid_name' using errcode = 'P0001';
  end if;
  select * into kept from public.profiles where user_id = me;
  if not found then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if not private.use_lookup(me) then
    raise exception 'lookup_limit' using errcode = 'P0001';
  end if;
  for attempt in 1..5 loop
    candidate := private.free_number(p_name, me, kept.discriminator);
    exit when candidate is null;
    begin
      update public.profiles
      set name = p_name, discriminator = candidate
      where user_id = me
      returning * into kept;
      return kept;
    exception when unique_violation then
      null;  -- another player took it meanwhile: draw again
    end;
  end loop;
  raise exception 'invalid_name' using errcode = 'P0001';
end
$$;

-- A name that looks blank or like another's is no name (L8). [[:alnum:]] takes the letters of every script, and Hangul has four
-- fillers that are letters and show as nothing: U+115F, U+1160, U+3164 and U+FFA0. And Unicode's NFKC folds letters that only look
-- different, a fullwidth Ａ or a bold 𝐀, into the ones they imitate, so a name that NFKC would change is refused. NFKC folds two of
-- the fillers too, but keeps U+115F and U+1160, so both rules are needed. Every other name that 0001 took stays a name.
create or replace function private.valid_name(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_name is not null and p_name ~ '^[[:alnum:] _-]{2,20}$' and p_name = pg_catalog.btrim(p_name)
    and p_name !~ '[\U0000115F\U00001160\U00003164\U0000FFA0]' and p_name is nfkc normalized
$$;

-- The table's own check follows, so that whatever writes a name keeps the rule. A check runs on every write of a row, whichever
-- column it changes, so a name that 0001 took and this rule refuses would have every later change of its player refused: while the
-- table holds one, its check stays 0001's, a notice says how many there are, and cloud/tests/profiles.sql fails until they are
-- renamed and this block is run again.
do $$
declare
  breaking bigint;
begin
  select pg_catalog.count(*) into breaking
  from public.profiles as p
  where p.name ~ '[\U0000115F\U00001160\U00003164\U0000FFA0]' or p.name is not nfkc normalized;
  if breaking > 0 then
    raise notice '% names break the rule of names of 0004, so profiles keeps the check of 0001', breaking;
  else
    alter table public.profiles drop constraint if exists profiles_name_fits;
    alter table public.profiles add constraint profiles_name_fits check (
      name ~ '^[[:alnum:] _-]{2,20}$' and name = btrim(name) and name !~ '[\U0000115F\U00001160\U00003164\U0000FFA0]'
      and name is nfkc normalized
    );
  end if;
end $$;

-- What a friend's card shows has a range (L9): an AR of 1 to 60, a UID of nine or ten digits, and a state that began no more than
-- 9,600 hours (400 days) before its last heartbeat and no later than five minutes after it, so that a card can't say AR 32767 or
-- online since the year 1. The window is in hours and not days because a day of timestamptz arithmetic follows the session's zone,
-- 23 or 25 hours across a change of the clocks, and a check has to give the same answer in every zone. A value outside them, which
-- only a client of its own could have written, goes first: an AR or a UID to none, which the next profile update sets again, and a
-- start to the nearest time inside.
update public.profiles set ar = null where ar not between 1 and 60;
update public.profiles set uid = null where uid not between 100000000 and 9999999999;
alter table public.profiles drop constraint if exists profiles_ar_fits;
alter table public.profiles add constraint profiles_ar_fits check (ar between 1 and 60);
alter table public.profiles drop constraint if exists profiles_uid_fits;
alter table public.profiles add constraint profiles_uid_fits check (uid between 100000000 and 9999999999);

update public.presence as p
set since = greatest(least(p.since, p.last_seen + interval '5 minutes'), p.last_seen - interval '9600 hours')
where p.since not between p.last_seen - interval '9600 hours' and p.last_seen + interval '5 minutes';
alter table public.presence drop constraint if exists presence_since_fits;
alter table public.presence add constraint presence_since_fits
  check (since between last_seen - interval '9600 hours' and last_seen + interval '5 minutes');

-- 0002's heartbeat, which keeps a start that is ahead of the server's clock as the server's now: a PC whose clock is more than five
-- minutes ahead would otherwise be refused by presence_since_fits, and lose its Status for every friend.
create or replace function public.heartbeat(p_state text, p_since timestamptz)
returns void
language sql
set search_path = ''
as $$
  insert into public.presence as p (user_id, state, since, last_seen)
  values (
    (select auth.uid()), p_state, case when p_since > pg_catalog.now() then pg_catalog.now() else p_since end, pg_catalog.now()
  )
  on conflict (user_id) do update
  set state = excluded.state, since = excluded.since, last_seen = excluded.last_seen
$$;

-- The accepted friends of the player asking, for the three policies below to ask once a statement (L10). They asked
-- private.is_friend, a definer function with a SET, which Postgres never inlines, so it ran for every row that was not the player's
-- own. `user_id in (select private.friend_ids())` runs it once and looks each row up in what it gave. private.is_friend stays, with
-- its grant, for nothing asks it now but what a later migration may.
create or replace function private.friend_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select f.user_b from public.friendships as f where f.user_a = (select auth.uid()) and f.status = 'accepted'
  union all
  select f.user_a from public.friendships as f where f.user_b = (select auth.uid()) and f.status = 'accepted'
$$;

revoke all on function private.friend_ids() from public, anon, authenticated, service_role;
-- A policy runs as the player, so the player has to be able to run what it asks, as with private.is_friend (0002).
grant execute on function private.friend_ids() to authenticated;

alter policy profiles_select on public.profiles
  using ((select auth.uid()) = user_id or user_id in (select private.friend_ids()));

alter policy shared_stats_select on public.shared_stats
  using ((select auth.uid()) = user_id or user_id in (select private.friend_ids()));

alter policy presence_select on public.presence
  using ((select auth.uid()) = user_id or user_id in (select private.friend_ids()));
