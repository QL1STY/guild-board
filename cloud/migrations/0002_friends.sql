-- Guild Board online, 0002: friends. Requests, shared stats, presence and invites.
-- Applied once, after 0001, as postgres (cloud/README.md). Refusals are `raise exception '<code>' using errcode = 'P0001'`,
-- with one exception, which send_friend_request explains; the core keeps the sentence the player reads for each code.

-- user_a < user_b, so that two players have one row, whichever of them asked.
create table public.friendships (
  user_a uuid not null references public.profiles (user_id) on delete cascade,
  user_b uuid not null references public.profiles (user_id) on delete cascade,
  status text not null default 'pending',
  requested_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  constraint friendships_in_order check (user_a < user_b),
  constraint friendships_status_fits check (status in ('pending', 'accepted')),
  constraint friendships_asked_by_one_of_them check (requested_by in (user_a, user_b))
);

create index friendships_user_b on public.friendships (user_b);

-- One row for each stat a player switched on. Status is a switch but no stat: it decides whether presence is written.
create table public.shared_stats (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key),
  constraint shared_stats_key_fits check (
    key in ('primogems', 'playtime', 'achievements', 'endgame', 'account', 'wishes', 'spending')
  ),
  constraint shared_stats_value_fits check (pg_column_size(value) <= 4096)
);

create table public.presence (
  user_id uuid primary key references public.profiles (user_id) on delete cascade,
  state text not null,
  since timestamptz not null,
  last_seen timestamptz not null default now(),
  constraint presence_state_fits check (state in ('in_game', 'open'))
);

create table public.invites (
  code text primary key,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  expires_at timestamptz not null default now() + interval '7 days'
);

create index invites_user_id on public.invites (user_id);

-- Requests sent, for the limit of 20 a day. A line goes once it is a day old.
create table private.request_log (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  at timestamptz not null default now()
);

create index request_log_user_id_at on private.request_log (user_id, at);

-- Each player's last lookup, for the limit of one a second.
create table private.lookup_log (
  user_id uuid primary key references public.profiles (user_id) on delete cascade,
  at timestamptz not null default now()
);

alter table public.friendships enable row level security;
alter table public.shared_stats enable row level security;
alter table public.presence enable row level security;
alter table public.invites enable row level security;

revoke all on table public.friendships from public, anon, authenticated, service_role;
revoke all on table public.shared_stats from public, anon, authenticated, service_role;
revoke all on table public.presence from public, anon, authenticated, service_role;
revoke all on table public.invites from public, anon, authenticated, service_role;
revoke all on table private.request_log from public, anon, authenticated, service_role;
revoke all on table private.lookup_log from public, anon, authenticated, service_role;

-- Friendships and invites change only through their functions. An upload names the key columns too, because PostgREST's
-- merge-duplicates sets every column it was sent. updated_at and the rest are the server's.
grant select on table public.friendships to authenticated;
grant select, delete on table public.shared_stats to authenticated;
grant insert (user_id, key, value), update (user_id, key, value) on table public.shared_stats to authenticated;
grant select on table public.presence to authenticated;
grant insert (user_id, state, since, last_seen), update (state, since, last_seen) on table public.presence to authenticated;

-- Whether the player asking and p_user are friends. It reads friendships past their policy, for the one question it asks of
-- the row of these two, and it is what every policy below asks.
create function private.is_friend(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.friendships as f
    where f.user_a = least((select auth.uid()), p_user)
      and f.user_b = greatest((select auth.uid()), p_user)
      and f.status = 'accepted'
  )
$$;

-- The card of each player a request waits on, either way: only what a request shows, and no stat, UID or picture link.
create function private.pending_cards()
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
  join public.friendships as f on f.status = 'pending' and me.id in (f.user_a, f.user_b)
  join public.profiles as them on them.user_id = case when f.user_a = me.id then f.user_b else f.user_a end
  order by f.created_at, them.user_id
$$;

-- Whether a switch of the player asking is on, for a row that is about to say so. It takes the row of their switches for
-- share: a set_sharing under way is waited for and its new list read, and one that comes later waits for this write to end
-- and then deletes what it left. A subquery in the policy would read the list as its statement began, so an upload under way
-- as the switch went off would stay, for friends to read, with the key off. Volatile, so that it reads when it is called.
create function private.switched_on(p_key text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform 1
  from public.profiles as p
  where p.user_id = (select auth.uid()) and p_key = any(p.sharing)
  for share;
  return found;
end
$$;

-- Whether a player may send one more request today. Only the definer functions below call this and the next two.
create function private.request_allowed(p_me uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select pg_catalog.count(*) < 20
  from private.request_log as l
  where l.user_id = p_me and l.at > pg_catalog.now() - interval '1 day'
$$;

create function private.friend_count(p_user uuid)
returns bigint
language sql
stable
set search_path = ''
as $$
  select pg_catalog.count(*)
  from public.friendships as f
  where f.status = 'accepted' and p_user in (f.user_a, f.user_b)
$$;

-- A request from p_me to p_them, whom a tag, a UID or an invite named: 'sent', or 'accepted' when they had asked first.
create function private.request_friend(p_me uuid, p_them uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  low constant uuid := least(p_me, p_them);
  high constant uuid := greatest(p_me, p_them);
  kept public.friendships;
begin
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
  if private.friend_count(p_me) >= 200 then
    raise exception 'friend_limit' using errcode = 'P0001';
  end if;
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

-- p_query is "Name#1234", the same name in any case, or a UID whose owner allows it. The answer is 'sent' or 'accepted'.
--
-- Two refusals are this function's answer and not a raise: 'no_such_tag' and 'no_such_uid'. A raise takes the whole call
-- back, the line in lookup_log with it, and a lookup that finds nobody is the one the limit is for. Don't "fix" them into
-- raises: the limit would count only the lookups that found someone. Every other refusal is a raise.
--
-- The limits come before the search, so that past 20 requests a tag that exists and one that doesn't answer alike. A UID
-- whose owner doesn't allow it answers as an unknown UID does.
create function public.send_friend_request(p_query text)
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
  insert into private.lookup_log as last (user_id, at) values (me, pg_catalog.now())
  on conflict (user_id) do update set at = excluded.at
  where last.at <= pg_catalog.now() - interval '1 second';
  if not found then
    raise exception 'lookup_limit' using errcode = 'P0001';
  end if;
  if not private.request_allowed(me) then
    raise exception 'request_limit' using errcode = 'P0001';
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

-- Only the one who was asked answers, with a true or a false: a null is no answer, and only a true opens the player's stats.
-- A decline deletes the request, so a player can ask again.
create function public.answer_friend_request(p_user uuid, p_accept boolean)
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
  if not found or kept.status <> 'pending' or kept.requested_by = me or p_accept is null then
    raise exception 'no_such_request' using errcode = 'P0001';
  end if;
  if not p_accept then
    delete from public.friendships as f where f.user_a = low and f.user_b = high;
    return;
  end if;
  if private.friend_count(me) >= 200 or private.friend_count(p_user) >= 200 then
    raise exception 'friend_limit' using errcode = 'P0001';
  end if;
  update public.friendships as f set status = 'accepted' where f.user_a = low and f.user_b = high;
end
$$;

-- Either side, a friendship or a request not yet answered. Nothing to remove is no refusal.
create function public.remove_friend(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me constant uuid := auth.uid();
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  delete from public.friendships as f where f.user_a = least(me, p_user) and f.user_b = greatest(me, p_user);
end
$$;

-- The switches: the list of keys that are on. In one step, a key that goes off loses its row and its pin, and Status its
-- presence, so that a friend's next read has nothing of it.
create function public.set_sharing(p_keys text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me constant uuid := auth.uid();
  every_key constant text[] := array[
    'status', 'primogems', 'playtime', 'achievements', 'endgame', 'account', 'wishes', 'spending'
  ];
  chosen text[];
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if p_keys is null or not p_keys <@ every_key then
    raise exception 'unknown_key' using errcode = 'P0001';
  end if;
  chosen := array(
    select t.key
    from pg_catalog.unnest(every_key) with ordinality as t(key, place)
    where t.key = any(p_keys)
    order by t.place
  );
  update public.profiles as p
  set sharing = chosen,
      pins = array(
        select t.pin
        from pg_catalog.unnest(p.pins) with ordinality as t(pin, place)
        where t.pin = any(chosen)
        order by t.place
      )
  where p.user_id = me;
  if not found then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  delete from public.shared_stats as s where s.user_id = me and not s.key = any(chosen);
  if not 'status' = any(chosen) then
    delete from public.presence as p where p.user_id = me;
  end if;
end
$$;

-- At most three pins, each a stat that is shared. Status always has its own place in a friend's row.
create function public.set_pins(p_keys text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me constant uuid := auth.uid();
  shared text[];
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  select p.sharing into shared from public.profiles as p where p.user_id = me;
  if not found then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if p_keys is null or 'status' = any(p_keys) or not p_keys <@ shared then
    raise exception 'pin_not_shared' using errcode = 'P0001';
  end if;
  if pg_catalog.cardinality(p_keys) > 3 then
    raise exception 'too_many_pins' using errcode = 'P0001';
  end if;
  update public.profiles as p
  set pins = array(
    select t.pin
    from pg_catalog.unnest(p_keys) with ordinality as t(pin, place)
    group by t.pin
    order by pg_catalog.min(t.place)
  )
  where p.user_id = me;
end
$$;

-- Runs as the player, so that the table's policy refuses it while Status is off. The time is the server's.
create function public.heartbeat(p_state text, p_since timestamptz)
returns void
language sql
set search_path = ''
as $$
  insert into public.presence as p (user_id, state, since, last_seen)
  values ((select auth.uid()), p_state, p_since, pg_catalog.now())
  on conflict (user_id) do update
  set state = excluded.state, since = excluded.since, last_seen = excluded.last_seen
$$;

-- The stats both share, for Compare: the switches of the two, so that the core and later the phone apply one rule. Runs as
-- the player, so an accepted friend alone is there to compare with: the policy of profiles hides everybody else.
create function public.compare_keys(p_friend uuid)
returns setof text
language sql
stable
set search_path = ''
as $$
  select t.key
  from public.profiles as mine
  join public.profiles as theirs on theirs.user_id = p_friend
  cross join lateral pg_catalog.unnest(mine.sharing) with ordinality as t(key, place)
  where mine.user_id = (select auth.uid())
    and t.key <> 'status'
    and t.key = any(theirs.sharing)
  order by t.place
$$;

-- One call for the Friends page. Runs as the player, so that row level security decides what is in it. seen_seconds comes
-- from the server's clock, so two PCs' clocks don't matter. Pending requests come through private.pending_cards alone.
create function public.friends_overview()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'friends', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'user_id', them.user_id,
        'name', them.name,
        'tag', them.discriminator,
        'has_picture', them.picture_url is not null,
        'ar', them.ar,
        'uid', them.uid,
        'presence', (
          select pg_catalog.jsonb_build_object(
            'state', seen.state,
            'since', seen.since,
            'seen_seconds', greatest(0, pg_catalog.floor(extract(epoch from pg_catalog.now() - seen.last_seen)))::integer
          )
          from public.presence as seen
          where seen.user_id = them.user_id
        ),
        'stats', coalesce((
          select pg_catalog.jsonb_object_agg(s.key, s.value)
          from public.shared_stats as s
          where s.user_id = them.user_id
        ), '{}'::jsonb),
        'pins', pg_catalog.to_jsonb(them.pins),
        'compare', exists (select 1 from public.compare_keys(them.user_id))
      ) order by pg_catalog.lower(them.name), them.user_id)
      from public.friendships as f
      join public.profiles as them
        on them.user_id = case when f.user_a = (select auth.uid()) then f.user_b else f.user_a end
      where f.status = 'accepted' and (select auth.uid()) in (f.user_a, f.user_b)
    ), '[]'::jsonb),
    'incoming', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'user_id', card.user_id, 'name', card.name, 'tag', card.tag, 'has_picture', card.has_picture, 'ar', card.ar
      ))
      from private.pending_cards() as card
      where card.direction = 'incoming'
    ), '[]'::jsonb),
    'outgoing', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'user_id', card.user_id, 'name', card.name, 'tag', card.tag, 'has_picture', card.has_picture, 'ar', card.ar
      ))
      from private.pending_cards() as card
      where card.direction = 'outgoing'
    ), '[]'::jsonb)
  )
$$;

-- An invite link's code: 18 random bytes as base64url, which fits the Edge Function's pattern. A code lasts seven days, and
-- a player holds the newest 20: this is the one table a client could otherwise grow without end.
create function public.make_invite()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me constant uuid := auth.uid();
  made text;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  delete from public.invites as i
  where i.user_id = me
    and (
      i.expires_at <= pg_catalog.now()
      or i.code in (
        select kept.code
        from public.invites as kept
        where kept.user_id = me
        order by kept.expires_at desc, kept.code
        offset 19
      )
    );
  made := pg_catalog.translate(pg_catalog.encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_');
  insert into public.invites (code, user_id) values (made, me);
  return made;
end
$$;

-- Who an invite is from, and nothing else: opening a link sends nothing, because the inviter accepts their own invite, and a
-- click alone would hand them the player's shared stats (the online design, section 0).
create function public.peek_invite(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me constant uuid := auth.uid();
  inviter public.profiles;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  select p.* into inviter
  from public.invites as i
  join public.profiles as p on p.user_id = i.user_id
  where i.code = p_code and i.expires_at > pg_catalog.now();
  if not found then
    raise exception 'invite_gone' using errcode = 'P0001';
  end if;
  if inviter.user_id = me then
    raise exception 'own_tag' using errcode = 'P0001';
  end if;
  return pg_catalog.jsonb_build_object(
    'name', inviter.name, 'tag', inviter.discriminator, 'has_picture', inviter.picture_url is not null, 'ar', inviter.ar
  );
end
$$;

-- The player pressed Send request: one request, and the code is spent. A refusal spends nothing.
create function public.redeem_invite(p_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me constant uuid := auth.uid();
  inviter uuid;
  answer text;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  select i.user_id into inviter
  from public.invites as i
  where i.code = p_code and i.expires_at > pg_catalog.now()
  for update;
  if not found then
    raise exception 'invite_gone' using errcode = 'P0001';
  end if;
  if inviter = me then
    raise exception 'own_tag' using errcode = 'P0001';
  end if;
  if not private.request_allowed(me) then
    raise exception 'request_limit' using errcode = 'P0001';
  end if;
  answer := private.request_friend(me, inviter);
  delete from public.invites as i where i.code = p_code;
  return answer;
end
$$;

-- What keeps a row's stamp the server's: a client holds no grant on updated_at. A trigger's function needs no grant to run.
create function private.stamp_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end
$$;

create trigger shared_stats_stamped
  before update on public.shared_stats
  for each row execute function private.stamp_updated_at();

create policy friendships_select on public.friendships
  for select to authenticated
  using ((select auth.uid()) = user_a or (select auth.uid()) = user_b);

create policy shared_stats_select on public.shared_stats
  for select to authenticated
  using ((select auth.uid()) = user_id or private.is_friend(user_id));

-- A row for a key that is off is refused, so that an upload on its way when the switch went off can't bring the row back.
create policy shared_stats_insert on public.shared_stats
  for insert to authenticated
  with check ((select auth.uid()) = user_id and private.switched_on(key));

create policy shared_stats_update on public.shared_stats
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and private.switched_on(key));

create policy shared_stats_delete on public.shared_stats
  for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy presence_select on public.presence
  for select to authenticated
  using ((select auth.uid()) = user_id or private.is_friend(user_id));

-- now() is the one value last_seen can take, so the time a friend reads is the server's, whatever a client sends.
create policy presence_insert on public.presence
  for insert to authenticated
  with check ((select auth.uid()) = user_id and last_seen = now() and private.switched_on('status'));

create policy presence_update on public.presence
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and last_seen = now() and private.switched_on('status'));

-- Nobody reaches invites but the functions above, and authenticated holds no grant on the table. This policy says so to the
-- project's security advisor, which asks of every table with row level security on for a policy.
create policy invites_nobody on public.invites
  for select to authenticated
  using (false);

-- Set in 0001 for the owner alone: an accepted friend reads the profile too. One policy, not a second one: two permissive
-- policies for one role and action run both, on every row.
alter policy profiles_select on public.profiles
  using ((select auth.uid()) = user_id or private.is_friend(user_id));

revoke all on function private.is_friend(uuid) from public, anon, authenticated, service_role;
revoke all on function private.pending_cards() from public, anon, authenticated, service_role;
revoke all on function private.switched_on(text) from public, anon, authenticated, service_role;
revoke all on function private.request_allowed(uuid) from public, anon, authenticated, service_role;
revoke all on function private.friend_count(uuid) from public, anon, authenticated, service_role;
revoke all on function private.request_friend(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.stamp_updated_at() from public, anon, authenticated, service_role;
revoke all on function public.send_friend_request(text) from public, anon, authenticated, service_role;
revoke all on function public.answer_friend_request(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.remove_friend(uuid) from public, anon, authenticated, service_role;
revoke all on function public.set_sharing(text[]) from public, anon, authenticated, service_role;
revoke all on function public.set_pins(text[]) from public, anon, authenticated, service_role;
revoke all on function public.heartbeat(text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.compare_keys(uuid) from public, anon, authenticated, service_role;
revoke all on function public.friends_overview() from public, anon, authenticated, service_role;
revoke all on function public.make_invite() from public, anon, authenticated, service_role;
revoke all on function public.peek_invite(text) from public, anon, authenticated, service_role;
revoke all on function public.redeem_invite(text) from public, anon, authenticated, service_role;

-- A policy runs as the player, and so does an invoker function, so these three helpers need a grant of their own, and the
-- schema has to open to authenticated. private.valid_name, private.free_number and the helpers above that only definer
-- functions call stay closed: the Data API doesn't expose this schema, and execute keeps a player from them.
grant usage on schema private to authenticated;
grant execute on function private.is_friend(uuid) to authenticated;
grant execute on function private.pending_cards() to authenticated;
grant execute on function private.switched_on(text) to authenticated;

grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.answer_friend_request(uuid, boolean) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.set_sharing(text[]) to authenticated;
grant execute on function public.set_pins(text[]) to authenticated;
grant execute on function public.heartbeat(text, timestamptz) to authenticated;
grant execute on function public.compare_keys(uuid) to authenticated;
grant execute on function public.friends_overview() to authenticated;
grant execute on function public.make_invite() to authenticated;
grant execute on function public.peek_invite(text) to authenticated;
grant execute on function public.redeem_invite(text) to authenticated;
