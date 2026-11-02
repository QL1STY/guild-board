-- Presence: one row while a player shares Status, written by the heartbeat and read by accepted friends. Run on the real
-- project in a transaction that never commits; it passes only when it ends in the error ALL PASSED (README.md here).
begin;

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@example.invalid'),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@example.invalid'),
  ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@example.invalid'),
  ('00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'd@example.invalid');

-- a and b are friends; c's request to a waits; d knows nobody.
insert into public.profiles (user_id, name, discriminator) values
  ('00000000-0000-0000-0000-00000000000a', 'Zznova', '1001'),
  ('00000000-0000-0000-0000-00000000000b', 'Zzriley', '1002'),
  ('00000000-0000-0000-0000-00000000000c', 'Zzkira', '1003'),
  ('00000000-0000-0000-0000-00000000000d', 'Zzmilo', '1004');
insert into public.friendships (user_a, user_b, status, requested_by) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', 'accepted', '00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000c', 'pending', '00000000-0000-0000-0000-00000000000c');

create function public.test_as(p_letter text) returns void language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000' || p_letter || '","role":"authenticated"}', true
  );
end $$;

create function public.test_forbids(p_call text) returns void language plpgsql as $$
begin
  execute p_call;
  raise exception 'this went through: %', p_call;
exception when insufficient_privilege then null;
end $$;

grant execute on function public.test_as(text), public.test_forbids(text) to anon, authenticated;

set local role authenticated;

-- The heartbeat is refused while Status is off; on, it writes the state, the time it began and the server's time.
do $$
declare
  kept public.presence;
  number bigint;
begin
  perform public.test_as('a');
  perform public.test_forbids($q$select public.heartbeat('open', now())$q$);
  select count(*) into number from public.presence;
  if number <> 0 then
    raise exception 'a refused heartbeat left a row';
  end if;
  perform public.test_forbids($q$insert into public.presence (user_id, state, since) values (auth.uid(), 'open', now())$q$);

  perform public.set_sharing('{status}');
  perform public.heartbeat('in_game', now() - interval '2 hours');
  perform public.heartbeat('in_game', now() - interval '2 hours');  -- the second one updates the same row
  select * into strict kept from public.presence;
  if kept.user_id <> '00000000-0000-0000-0000-00000000000a' or kept.state <> 'in_game'
     or kept.since <> now() - interval '2 hours' or kept.last_seen <> now() then
    raise exception 'a heartbeat wrote %', kept;
  end if;

  begin
    perform public.heartbeat('asleep', now());
    raise exception 'a heartbeat took a state outside the list';
  exception when check_violation then null;
  end;

  -- A state began no more than 9,600 hours (400 days) before its heartbeat and no later than five minutes after it, so that a
  -- friend's card can't say online since the year 1 (0004). A heartbeat keeps a start ahead of the server's clock as now, so that a
  -- PC whose clock is ahead keeps its Status; a client's own write of one past five minutes ahead is refused.
  perform public.heartbeat('in_game', now() + interval '1 day');
  select * into strict kept from public.presence;
  if kept.since <> now() then
    raise exception 'a state that began ahead of the server was kept as %', kept.since;
  end if;
  begin
    perform public.heartbeat('in_game', now() - interval '9601 hours');
    raise exception 'a heartbeat took a state that began 9,601 hours ago';
  exception when check_violation then null;
  end;
  begin
    update public.presence set since = now() + interval '6 minutes', last_seen = now();
    raise exception 'a client wrote a state that begins six minutes ahead';
  exception when check_violation then null;
  end;
  perform public.heartbeat('in_game', now() - interval '9600 hours');
  perform public.heartbeat('in_game', now() - interval '2 hours');

  -- The time last seen is the server's, whatever a client says.
  perform public.test_forbids($q$update public.presence set last_seen = now() + interval '1 day'$q$);
  perform public.test_forbids($q$update public.presence set last_seen = now() - interval '1 day'$q$);
  perform public.test_forbids($q$delete from public.presence$q$);
  perform public.test_forbids($q$truncate public.presence$q$);

  -- A player writes their own row alone, and a first row takes no time of its own either.
  perform public.test_as('b');
  perform public.set_sharing('{status}');
  perform public.test_forbids($q$insert into public.presence (user_id, state, since, last_seen)
    values (auth.uid(), 'open', now(), now() + interval '1 day')$q$);
  perform public.test_forbids($q$insert into public.presence (user_id, state, since)
    values ('00000000-0000-0000-0000-00000000000a', 'open', now())$q$);
  update public.presence set state = 'open';
  get diagnostics number = row_count;
  if number <> 0 then
    raise exception 'a friend updated % rows of presence', number;
  end if;
  perform public.set_sharing('{}');
end $$;

-- The same four readers as a stat: the owner, an accepted friend whatever they share, and not the other two.
do $$
declare
  number bigint;
  seen jsonb;
begin
  perform public.test_as('a');
  select count(*) into number from public.presence;
  if number <> 1 then
    raise exception 'the owner sees % rows', number;
  end if;
  perform public.test_as('b');
  select count(*) into number from public.presence;
  if number <> 1 then
    raise exception 'an accepted friend sees % rows', number;
  end if;
  -- Its columns and none of the system columns, which change with each write and lock of the row (0004).
  perform public.test_forbids($q$select xmin, xmax from public.presence$q$);
  perform public.test_forbids($q$select ctid from public.presence$q$);
  perform public.test_as('c');
  select count(*) into number from public.presence;
  if number <> 0 then
    raise exception 'a pending friend sees % rows', number;
  end if;
  seen := public.friends_overview();
  if seen::text ~ 'in_game|seen_seconds' then
    raise exception 'a pending request carries presence: %', seen;
  end if;
  perform public.test_as('d');
  select count(*) into number from public.presence;
  if number <> 0 then
    raise exception 'a stranger sees % rows', number;
  end if;
end $$;

-- seen_seconds comes from the server's clock, so two PCs' clocks don't matter.
do $$
declare
  seen jsonb;
begin
  perform public.test_as('b');
  seen := public.friends_overview()->'friends'->0->'presence';
  if seen->>'state' <> 'in_game' or (seen->>'seen_seconds')::int <> 0 or (seen->>'since')::timestamptz <> now() - interval '2 hours' then
    raise exception 'presence is %', seen;
  end if;
end $$;
reset role;
update public.presence set last_seen = now() - interval '200 seconds'
where user_id = '00000000-0000-0000-0000-00000000000a';
set local role authenticated;
do $$
declare
  seen jsonb;
begin
  perform public.test_as('b');
  seen := public.friends_overview()->'friends'->0->'presence';
  if (seen->>'seen_seconds')::int <> 200 then
    raise exception 'seen_seconds is not the server''s: %', seen;
  end if;
  if (select count(*) from jsonb_object_keys(seen)) <> 3 then
    raise exception 'presence carries more than the contract: %', seen;
  end if;
end $$;

-- Status off: the row goes at once, and a friend sees null, not an old state.
do $$
declare
  number bigint;
  seen jsonb;
begin
  perform public.test_as('a');
  perform public.set_sharing('{}');
  select count(*) into number from public.presence;
  if number <> 0 then
    raise exception 'set_sharing without status kept the row';
  end if;
  perform public.test_forbids($q$select public.heartbeat('open', now())$q$);
  perform public.test_as('b');
  seen := public.friends_overview()->'friends'->0;
  if seen->'presence' <> 'null' then
    raise exception 'a hidden status shows as %', seen->'presence';
  end if;
end $$;

-- Without a session: the table and the heartbeat are refused.
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  perform public.test_forbids($q$select count(*) from public.presence$q$);
  perform public.test_forbids($q$select public.heartbeat('open', now())$q$);
end $$;
reset role;

-- Delete my online data takes the row with it.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
do $$
begin
  perform public.set_sharing('{status}');
  perform public.heartbeat('open', now());
  perform public.delete_my_account();
end $$;
reset role;

-- The check of a state's start is the same in every zone (0004): its window is 9,600 hours and not 400 days, as a day of timestamptz
-- arithmetic follows the session's zone. Between these two times Warsaw's clocks went back twice and forward once, so 400 of its days
-- are 9,601 hours, and a check in days would take there a start that UTC refuses.
do $$
declare
  zone constant text := current_setting('timezone');
  seen constant timestamptz := '2026-11-01 12:00:00+00';
begin
  perform set_config('timezone', 'Europe/Warsaw', true);
  begin
    insert into public.presence (user_id, state, since, last_seen)
    values ('00000000-0000-0000-0000-00000000000d', 'open', seen - interval '9600 hours' - interval '30 minutes', seen);
    raise exception 'a start 9,600 hours and a half before the last heartbeat went in, in Warsaw';
  exception when check_violation then null;
  end;
  insert into public.presence (user_id, state, since, last_seen)
  values ('00000000-0000-0000-0000-00000000000d', 'open', seen - interval '9600 hours', seen);
  delete from public.presence where user_id = '00000000-0000-0000-0000-00000000000d';
  perform set_config('timezone', zone, true);
end $$;

-- The shape of it.
do $$
declare
  role_name text;
begin
  if exists (select 1 from public.presence where user_id = '00000000-0000-0000-0000-00000000000a') then
    raise exception 'delete_my_account left presence';
  end if;
  if not (select relrowsecurity from pg_catalog.pg_class where oid = 'public.presence'::regclass) then
    raise exception 'presence has row level security off';
  end if;
  if has_table_privilege('authenticated', 'public.presence', 'delete,truncate,references,trigger') then
    raise exception 'authenticated holds more of presence than its policies need';
  end if;
  -- A client reads it column by column, so that it can't select the system columns (0004).
  if has_table_privilege('authenticated', 'public.presence', 'select') then
    raise exception 'authenticated reads the whole table of presence, system columns and all';
  end if;
  if not has_column_privilege('authenticated', 'public.presence', 'user_id', 'select')
     or not has_column_privilege('authenticated', 'public.presence', 'state', 'select')
     or not has_column_privilege('authenticated', 'public.presence', 'since', 'select')
     or not has_column_privilege('authenticated', 'public.presence', 'last_seen', 'select') then
    raise exception 'authenticated cannot read a column of presence';
  end if;
  foreach role_name in array array['anon', 'service_role'] loop
    if has_table_privilege(role_name, 'public.presence', 'select,insert,update,delete,truncate,references,trigger') then
      raise exception '% holds a part of presence', role_name;
    end if;
  end loop;
  if (select prosecdef from pg_catalog.pg_proc where oid = 'public.heartbeat(text,timestamptz)'::regprocedure) then
    raise exception 'heartbeat is security definer';
  end if;
  -- A heartbeat under way can't bring the row back: shared_stats.sql says how, and this is the same check.
  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'presence' and cmd in ('INSERT', 'UPDATE') and with_check !~ 'switched_on'
  ) then
    raise exception 'a heartbeat is not held to the switch as it is now';
  end if;
  if (select proconfig from pg_catalog.pg_proc where oid = 'public.heartbeat(text,timestamptz)'::regprocedure)
     is distinct from array['search_path=""'] then
    raise exception 'heartbeat does not set an empty search_path';
  end if;
  if not has_function_privilege('authenticated', 'public.heartbeat(text,timestamptz)', 'execute') then
    raise exception 'authenticated cannot run heartbeat';
  end if;
  foreach role_name in array array['anon', 'service_role', 'public'] loop
    if has_function_privilege(role_name, 'public.heartbeat(text,timestamptz)', 'execute') then
      raise exception '% can run heartbeat', role_name;
    end if;
  end loop;
end $$;

do $$ begin raise exception 'ALL PASSED'; end $$;
rollback;
