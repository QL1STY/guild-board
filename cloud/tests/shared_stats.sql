-- What friends can read: the rows of the stats a player switched on, and nothing else. Run on the real project in a
-- transaction that never commits; it passes only when it ends in the error ALL PASSED (README.md here).
begin;

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@example.invalid'),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@example.invalid'),
  ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@example.invalid'),
  ('00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'd@example.invalid');

-- a and b are friends; c's request to a waits; d knows nobody.
insert into public.profiles (user_id, name, discriminator, ar, uid, picture_url) values
  ('00000000-0000-0000-0000-00000000000a', 'Zznova', '1001', 58, 9000000011, 'https://upload-static.hoyoverse.com/a.png'),
  ('00000000-0000-0000-0000-00000000000b', 'Zzriley', '1002', 41, null, null),
  ('00000000-0000-0000-0000-00000000000c', 'Zzkira', '1003', 30, null, 'https://upload-static.hoyoverse.com/c.png'),
  ('00000000-0000-0000-0000-00000000000d', 'Zzmilo', '1004', null, null, null);
insert into public.friendships (user_a, user_b, status, requested_by) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', 'accepted', '00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000c', 'pending', '00000000-0000-0000-0000-00000000000c');

create function public.test_as(p_letter text) returns void language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000' || p_letter || '","role":"authenticated"}', true
  );
end $$;

create function public.test_refuses(p_call text, p_code text) returns void language plpgsql as $$
begin
  execute p_call;
  raise exception 'not refused with %: %', p_code, p_call;
exception when raise_exception then
  if sqlerrm <> p_code then
    raise;
  end if;
end $$;

create function public.test_forbids(p_call text) returns void language plpgsql as $$
begin
  execute p_call;
  raise exception 'this went through: %', p_call;
exception when insufficient_privilege then null;
end $$;

-- What an upload is: PostgREST's merge-duplicates sets every column it was sent, the key columns too.
create function public.test_upload(p_key text, p_value jsonb) returns void language plpgsql as $$
begin
  insert into public.shared_stats (user_id, key, value)
  values (auth.uid(), p_key, p_value)
  on conflict (user_id, key) do update
  set user_id = excluded.user_id, key = excluded.key, value = excluded.value;
end $$;

grant execute on function
  public.test_as(text), public.test_refuses(text, text), public.test_forbids(text), public.test_upload(text, jsonb)
  to anon, authenticated;

set local role authenticated;

-- Off by default: nothing goes up. Once on, the row goes up, and an upload again replaces it.
do $$
declare
  kept jsonb;
  number bigint;
begin
  perform public.test_as('a');
  perform public.test_forbids($q$select public.test_upload('primogems', '{"now": 1}')$q$);

  perform public.set_sharing('{status,primogems,playtime,achievements}');
  perform public.test_upload('primogems', '{"now": 16040}');
  perform public.test_upload('primogems', '{"now": 16041}');
  perform public.test_upload('playtime', '{"week_hours": 18.0}');
  select value into strict kept from public.shared_stats where key = 'primogems';
  if kept <> '{"now": 16041}' then
    raise exception 'an upload did not replace the row: %', kept;
  end if;

  -- A row for a key that is off is refused, however it comes.
  perform public.test_forbids($q$select public.test_upload('endgame', '{"abyss_stars": 36}')$q$);
  perform public.test_forbids($q$insert into public.shared_stats (user_id, key, value)
    values (auth.uid(), 'wishes', '{"pity": 62}')$q$);
  perform public.test_forbids($q$update public.shared_stats set key = 'endgame' where key = 'primogems'$q$);

  -- A player writes their own rows alone.
  perform public.test_forbids($q$insert into public.shared_stats (user_id, key, value)
    values ('00000000-0000-0000-0000-00000000000b', 'primogems', '{}')$q$);
  perform public.test_forbids($q$update public.shared_stats set updated_at = now()$q$);
  perform public.test_forbids($q$truncate public.shared_stats$q$);

  perform public.test_as('b');
  perform public.set_sharing('{primogems}');
  update public.shared_stats set value = '{}';
  get diagnostics number = row_count;
  if number <> 0 then
    raise exception 'a friend updated % of a player''s rows', number;
  end if;
  delete from public.shared_stats;
  get diagnostics number = row_count;
  if number <> 0 then
    raise exception 'a friend deleted % of a player''s rows', number;
  end if;
  perform public.set_sharing('{}');
end $$;

-- Who reads them.
do $$
declare
  number bigint;
  card public.profiles;
begin
  perform public.test_as('b');  -- an accepted friend who shares nothing sees every row all the same
  select count(*) into number from public.shared_stats;
  if number <> 2 then
    raise exception 'an accepted friend sees % rows', number;
  end if;
  -- What the policies ask once a statement, for each of the four (0004): the accepted friends of the one asking, and nobody else.
  if array(select private.friend_ids()) <> array['00000000-0000-0000-0000-00000000000a'::uuid] then
    raise exception 'friend_ids gave a friend %', array(select private.friend_ids());
  end if;
  perform public.test_as('a');
  if array(select private.friend_ids()) <> array['00000000-0000-0000-0000-00000000000b'::uuid] then
    raise exception 'friend_ids gave the other side %', array(select private.friend_ids());
  end if;
  perform public.test_as('c');
  if array(select private.friend_ids()) <> '{}'::uuid[] then
    raise exception 'friend_ids gave a pending friend %', array(select private.friend_ids());
  end if;
  perform public.test_as('d');
  if array(select private.friend_ids()) <> '{}'::uuid[] then
    raise exception 'friend_ids gave a stranger %', array(select private.friend_ids());
  end if;
  perform public.test_as('b');
  perform public.test_as('c');  -- a request that waits shows nothing
  select count(*) into number from public.shared_stats;
  if number <> 0 then
    raise exception 'a pending friend sees % rows', number;
  end if;
  perform public.test_as('d');
  select count(*) into number from public.shared_stats;
  if number <> 0 then
    raise exception 'a stranger sees % rows', number;
  end if;

  -- The same goes for a profile: the friend reads it, and the others don't.
  perform public.test_as('b');
  select count(*) into number from public.profiles where user_id = '00000000-0000-0000-0000-00000000000a';
  if number <> 1 then
    raise exception 'an accepted friend cannot read the profile';
  end if;
  -- Every column of it, and none of the system columns: xmax changes whenever the server holds the row, as each sync, stat upload
  -- and heartbeat of the player does, and would tell a friend that the PC is on with Status off (0004).
  select * into strict card from public.profiles where user_id = '00000000-0000-0000-0000-00000000000a';
  if card.name <> 'Zznova' or card.uid <> 9000000011 then
    raise exception 'a friend reads the profile as %', card;
  end if;
  perform public.test_forbids($q$select xmin, xmax from public.profiles where user_id = '00000000-0000-0000-0000-00000000000a'$q$);
  perform public.test_forbids($q$select ctid from public.profiles where user_id = '00000000-0000-0000-0000-00000000000a'$q$);
  perform public.test_forbids($q$select xmin from public.shared_stats where user_id = '00000000-0000-0000-0000-00000000000a'$q$);
  perform public.test_forbids($q$update public.profiles set name = 'Other'$q$);
  update public.profiles set ar = 1 where user_id = '00000000-0000-0000-0000-00000000000a';
  get diagnostics number = row_count;
  if number <> 0 then
    raise exception 'a friend updated a profile';
  end if;
  perform public.test_as('c');
  select count(*) into number from public.profiles where user_id = '00000000-0000-0000-0000-00000000000a';
  if number <> 0 then
    raise exception 'a pending friend read the profile';
  end if;
  perform public.test_as('d');
  select count(*) into number from public.profiles where user_id = '00000000-0000-0000-0000-00000000000a';
  if number <> 0 then
    raise exception 'a stranger read the profile';
  end if;
end $$;

-- A value is at most 1,024 bytes, as 0003 has it: exactly that goes in, and a byte more does not. The largest value there is, six
-- months of primogems of ten digits each, has room to spare, by the size the table counts and not by the length of its text. A key
-- outside the list is refused by the table itself, past the policies too.
do $$
declare
  room constant integer := 1024 - pg_column_size(jsonb_build_object('x', ''));
  largest constant jsonb := jsonb_build_object('now', 9999999999, 'months', (
    select jsonb_agg(jsonb_build_object('month', '2026-' || lpad(n::text, 2, '0'), 'earned', 9999999999)) from generate_series(5, 10) as n
  ));
begin
  perform public.test_as('a');
  if pg_column_size(largest) > 512 then
    raise exception 'the largest value takes % bytes', pg_column_size(largest);
  end if;
  perform public.test_upload('primogems', largest);
  if pg_column_size(jsonb_build_object('x', repeat('x', room))) <> 1024 then
    raise exception 'this test does not build the value it means';
  end if;
  perform public.test_upload('primogems', jsonb_build_object('x', repeat('x', room)));
  begin
    perform public.test_upload('primogems', jsonb_build_object('x', repeat('x', room + 1)));
    raise exception 'a value of 1,025 bytes went in';
  exception when check_violation then null;
  end;
end $$;
reset role;
do $$
begin
  begin
    insert into public.shared_stats (user_id, key, value) values ('00000000-0000-0000-0000-00000000000a', 'gallery', '{}');
    raise exception 'the table took a key outside the list';
  exception when check_violation then null;
  end;
  begin
    insert into public.shared_stats (user_id, key, value) values ('00000000-0000-0000-0000-00000000000a', 'status', '{}');
    raise exception 'the table took status as a stat';
  exception when check_violation then null;
  end;
end $$;

-- A change of a row stamps it, by the server's clock. Nobody reads the stamp, as 0003 has it: it would tell a friend that the PC was
-- on, with Status off. What a stat says is read all the same, by its owner and by a friend.
insert into public.shared_stats (user_id, key, value, updated_at)
values ('00000000-0000-0000-0000-00000000000a', 'achievements', '{"ticked": 1}', now() - interval '1 day');
set local role authenticated;
do $$
begin
  perform public.test_as('a');
  perform public.test_upload('achievements', '{"ticked": 2}');
  perform public.test_forbids($q$select updated_at from public.shared_stats$q$);
  perform public.test_forbids($q$select * from public.shared_stats$q$);
  if (select value from public.shared_stats where key = 'achievements') <> '{"ticked": 2}' then
    raise exception 'the owner cannot read a value';
  end if;
  perform public.test_as('b');
  perform public.test_forbids($q$select updated_at from public.shared_stats where user_id = '00000000-0000-0000-0000-00000000000a'$q$);
  if (select value from public.shared_stats where user_id = '00000000-0000-0000-0000-00000000000a' and key = 'achievements') <> '{"ticked": 2}' then
    raise exception 'a friend cannot read a value';
  end if;
end $$;
reset role;
do $$
declare
  stamped timestamptz;
begin
  select updated_at into strict stamped from public.shared_stats
  where user_id = '00000000-0000-0000-0000-00000000000a' and key = 'achievements';
  if stamped <> now() then
    raise exception 'a new value did not stamp the row: %', stamped;
  end if;
end $$;
set local role authenticated;

-- compare_keys: what both share, and for an accepted friend alone.
do $$
declare
  found_keys text[];
begin
  perform public.test_as('b');
  perform public.set_sharing('{status,playtime,achievements,wishes}');
  found_keys := array(select public.compare_keys('00000000-0000-0000-0000-00000000000a'));
  if found_keys <> '{playtime,achievements}' then
    raise exception 'compare_keys gave %, not the stats both share', found_keys;
  end if;
  perform public.test_as('a');
  found_keys := array(select public.compare_keys('00000000-0000-0000-0000-00000000000b'));
  if found_keys <> '{playtime,achievements}' then  -- both share Status too: it is a switch, and no stat
    raise exception 'compare_keys gave the other side %', found_keys;
  end if;

  -- A request that waits and a stranger give nothing, whatever both share, from either side.
  perform public.test_as('c');
  perform public.set_sharing('{playtime}');
  found_keys := array(select public.compare_keys('00000000-0000-0000-0000-00000000000a'));
  if found_keys <> '{}' then
    raise exception 'compare_keys gave a pending friend %', found_keys;
  end if;
  perform public.set_sharing('{}');
  perform public.test_as('d');
  perform public.set_sharing('{playtime}');
  found_keys := array(select public.compare_keys('00000000-0000-0000-0000-00000000000a'));
  if found_keys <> '{}' then
    raise exception 'compare_keys gave a stranger %', found_keys;
  end if;
  perform public.set_sharing('{}');
  perform public.test_as('a');
  found_keys := array(select public.compare_keys('00000000-0000-0000-0000-00000000000c'));
  if found_keys <> '{}' then
    raise exception 'compare_keys gave % for a pending request', found_keys;
  end if;
  found_keys := array(select public.compare_keys('00000000-0000-0000-0000-00000000000d'));
  if found_keys <> '{}' then
    raise exception 'compare_keys gave % for a stranger', found_keys;
  end if;
end $$;

-- set_sharing and set_pins: a key that goes off takes its row and its pin, and a pin needs a stat that is on.
do $$
declare
  kept public.profiles;
  number bigint;
begin
  perform public.test_as('a');
  perform public.set_pins('{playtime,primogems}');
  select * into strict kept from public.profiles where user_id = '00000000-0000-0000-0000-00000000000a';
  if kept.pins <> '{playtime,primogems}' then
    raise exception 'set_pins kept %', kept.pins;
  end if;
  perform public.test_refuses($q$select public.set_pins('{endgame}')$q$, 'pin_not_shared');
  perform public.test_refuses($q$select public.set_pins('{status}')$q$, 'pin_not_shared');
  perform public.test_refuses($q$select public.set_pins('{nonsense}')$q$, 'pin_not_shared');
  perform public.test_refuses($q$select public.set_pins(null)$q$, 'pin_not_shared');

  perform public.set_sharing('{status,primogems,playtime,achievements,wishes}');
  perform public.set_pins('{playtime,primogems,wishes}');
  perform public.test_refuses($q$select public.set_pins('{playtime,primogems,wishes,achievements}')$q$, 'too_many_pins');
  perform public.test_refuses($q$select public.set_sharing('{primogems,gallery}')$q$, 'unknown_key');
  perform public.test_refuses($q$select public.set_sharing(null)$q$, 'unknown_key');

  -- The same stat twice is one, and the switches keep the list's order.
  perform public.set_pins('{wishes,wishes}');
  select * into strict kept from public.profiles where user_id = '00000000-0000-0000-0000-00000000000a';
  if kept.pins <> '{wishes}' then
    raise exception 'set_pins kept %', kept.pins;
  end if;
  perform public.set_pins('{wishes,playtime,primogems}');
  perform public.set_sharing('{wishes,primogems,primogems,status,playtime}');
  select * into strict kept from public.profiles where user_id = '00000000-0000-0000-0000-00000000000a';
  if kept.sharing <> '{status,primogems,playtime,wishes}' then
    raise exception 'set_sharing kept %', kept.sharing;
  end if;

  perform public.set_sharing('{status,playtime,wishes}');
  select * into strict kept from public.profiles where user_id = '00000000-0000-0000-0000-00000000000a';
  if kept.sharing <> '{status,playtime,wishes}' then
    raise exception 'set_sharing kept %', kept.sharing;
  end if;
  if kept.pins <> '{wishes,playtime}' then
    raise exception 'a key turned off left the pins at %', kept.pins;
  end if;
  select count(*) into number from public.shared_stats where key = 'primogems';
  if number <> 0 then
    raise exception 'a key turned off kept its row';
  end if;
  select count(*) into number from public.shared_stats where key = 'playtime';
  if number <> 1 then
    raise exception 'a key left on lost its row';
  end if;
  perform public.test_as('b');
  select count(*) into number from public.shared_stats where key = 'primogems';
  if number <> 0 then
    raise exception 'a friend still sees a key turned off';
  end if;

  perform public.test_as('a');
  perform public.set_pins('{}');
  select * into strict kept from public.profiles where user_id = '00000000-0000-0000-0000-00000000000a';
  if kept.pins <> '{}' then
    raise exception 'set_pins did not clear the pins: %', kept.pins;
  end if;

  -- An upload that was on its way when the key went off can't bring the row back.
  perform public.test_forbids($q$select public.test_upload('primogems', '{"now": 1}')$q$);
end $$;

-- friends_overview: friends with what they share, pending requests as cards alone, and nothing of anyone else.
do $$
declare
  seen jsonb;
  friend jsonb;
  card jsonb;
begin
  perform public.test_as('a');
  perform public.test_upload('wishes', '{"pity": 62}');
  perform public.set_pins('{wishes}');

  perform public.test_as('b');
  seen := public.friends_overview();
  if seen->'incoming' <> '[]' or seen->'outgoing' <> '[]' or jsonb_array_length(seen->'friends') <> 1 then
    raise exception 'a friend''s overview is %', seen;
  end if;
  friend := seen->'friends'->0;
  if friend->>'user_id' <> '00000000-0000-0000-0000-00000000000a' or friend->>'name' <> 'Zznova' or friend->>'tag' <> '1001'
     or (friend->>'has_picture')::boolean is not true or (friend->>'ar')::int <> 58 or (friend->>'uid')::bigint <> 9000000011
     or friend->'pins' <> '["wishes"]' or (friend->>'compare')::boolean is not true then
    raise exception 'a friend is not what the contract says: %', friend;
  end if;
  if friend->'stats'->'wishes' <> '{"pity": 62}' or friend->'stats'->'playtime' is null or friend->'stats' ? 'primogems' then
    raise exception 'a friend''s stats are %', friend->'stats';
  end if;
  if (select count(*) from jsonb_object_keys(friend)) <> 10 then
    raise exception 'a friend carries more than the contract: %', friend;
  end if;

  -- The one asked sees the card under incoming, and the asker under outgoing, with its fields alone.
  perform public.test_as('a');
  seen := public.friends_overview();
  card := seen->'incoming'->0;
  if jsonb_array_length(seen->'incoming') <> 1 or seen->'outgoing' <> '[]' or jsonb_array_length(seen->'friends') <> 1 then
    raise exception 'an overview with a request is %', seen;
  end if;
  if card <> '{"user_id": "00000000-0000-0000-0000-00000000000c", "name": "Zzkira", "tag": "1003", "has_picture": true, "ar": 30}' then
    raise exception 'an incoming card is %', card;
  end if;
  perform public.test_as('c');
  seen := public.friends_overview();
  card := seen->'outgoing'->0;
  if jsonb_array_length(seen->'outgoing') <> 1 or seen->'incoming' <> '[]' or seen->'friends' <> '[]' then
    raise exception 'the asker''s overview is %', seen;
  end if;
  if card <> '{"user_id": "00000000-0000-0000-0000-00000000000a", "name": "Zznova", "tag": "1001", "has_picture": true, "ar": 58}' then
    raise exception 'an outgoing card is %', card;
  end if;
  if seen::text ~ 'pity|week_hours|9000000011' then
    raise exception 'a pending request carries a stat or the UID: %', seen;
  end if;

  perform public.test_as('d');
  seen := public.friends_overview();
  if seen <> '{"friends": [], "incoming": [], "outgoing": []}' then
    raise exception 'a stranger''s overview is %', seen;
  end if;
end $$;

-- Without a session: the table and every function are refused.
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  perform public.test_forbids($q$select count(*) from public.shared_stats$q$);
  perform public.test_forbids($q$select public.set_sharing('{}')$q$);
  perform public.test_forbids($q$select public.set_pins('{}')$q$);
  perform public.test_forbids($q$select public.compare_keys('00000000-0000-0000-0000-00000000000a')$q$);
  perform public.test_forbids($q$select public.friends_overview()$q$);
end $$;
reset role;

-- Delete my online data takes the rows with it.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
do $$
begin
  perform public.delete_my_account();
end $$;
reset role;
do $$
begin
  if exists (select 1 from public.shared_stats where user_id = '00000000-0000-0000-0000-00000000000a') then
    raise exception 'delete_my_account left the shared stats';
  end if;
end $$;

-- The shape of it.
do $$
declare
  name text;
  role_name text;
begin
  if not (select relrowsecurity from pg_catalog.pg_class where oid = 'public.shared_stats'::regclass) then
    raise exception 'shared_stats has row level security off';
  end if;
  if has_table_privilege('authenticated', 'public.shared_stats', 'select,truncate,references,trigger') then
    raise exception 'authenticated holds more of shared_stats than its policies need';
  end if;
  if has_column_privilege('authenticated', 'public.shared_stats', 'updated_at', 'select') then
    raise exception 'authenticated can read when a stat changed';
  end if;
  foreach role_name in array array['anon', 'service_role'] loop
    if has_table_privilege(role_name, 'public.shared_stats', 'select,insert,update,delete,truncate,references,trigger') then
      raise exception '% holds a part of shared_stats', role_name;
    end if;
  end loop;

  foreach name in array array['public.set_sharing(text[])', 'public.set_pins(text[])'] loop
    if not (select prosecdef from pg_catalog.pg_proc where oid = name::regprocedure) then
      raise exception '% is not security definer', name;
    end if;
  end loop;

  -- What keeps an upload under way from bringing a row back: a check that waits for set_sharing and reads what it left. A
  -- subquery in the policy reads the switches as its statement began. Only two connections can show the wait, and a file here
  -- has one, so this holds the means: the function is volatile, and both checks ask it.
  if (select provolatile::text from pg_catalog.pg_proc where oid = 'private.switched_on(text)'::regprocedure) <> 'v' then
    raise exception 'switched_on would read the switches as the statement began';
  end if;
  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'shared_stats' and cmd in ('INSERT', 'UPDATE') and with_check !~ 'switched_on'
  ) then
    raise exception 'an upload is not held to the switch as it is now';
  end if;
  foreach name in array array['public.compare_keys(uuid)', 'public.friends_overview()'] loop
    if (select prosecdef from pg_catalog.pg_proc where oid = name::regprocedure) then
      raise exception '% is security definer', name;
    end if;
  end loop;
  foreach name in array array[
    'public.set_sharing(text[])', 'public.set_pins(text[])', 'public.compare_keys(uuid)', 'public.friends_overview()'
  ] loop
    if (select proconfig from pg_catalog.pg_proc where oid = name::regprocedure) is distinct from array['search_path=""'] then
      raise exception '% does not set an empty search_path', name;
    end if;
    if not has_function_privilege('authenticated', name, 'execute') then
      raise exception 'authenticated cannot run %', name;
    end if;
    foreach role_name in array array['anon', 'service_role', 'public'] loop
      if has_function_privilege(role_name, name, 'execute') then
        raise exception '% can run %', role_name, name;
      end if;
    end loop;
  end loop;
end $$;

do $$ begin raise exception 'ALL PASSED'; end $$;
rollback;
