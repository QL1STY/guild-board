-- Finding a player: an exact tag, or an exact UID whose owner allows it, once a second. Run on the real project in a
-- transaction that never commits; it passes only when it ends in the error ALL PASSED (README.md here).
begin;

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@example.invalid'),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@example.invalid'),
  ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@example.invalid');

insert into public.profiles (user_id, name, discriminator, uid, find_by_uid) values
  ('00000000-0000-0000-0000-00000000000a', 'Zznova', '1001', 9000000011, false),
  ('00000000-0000-0000-0000-00000000000b', 'Zz Riley', '7687', 9000000012, false),
  ('00000000-0000-0000-0000-00000000000c', 'Zzkira', '1003', 9000000013, true);

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

-- A lookup is refused within a second of the last one, and now() stands still in a transaction. This is the second passing,
-- for the player asking.
create function public.test_a_second_later() returns void language sql security definer set search_path = '' as $$
  delete from private.lookup_log where user_id = auth.uid()
$$;

-- One lookup that must find its player: it sends the request, which is taken back, so that the next one starts clean.
create function public.test_finds(p_query text, p_friend uuid) returns void language plpgsql as $$
declare
  said text;
begin
  perform public.test_a_second_later();
  said := public.send_friend_request(p_query);
  if said <> 'sent' then
    raise exception '% answered %', p_query, said;
  end if;
  if not exists (select 1 from public.friendships where p_friend in (user_a, user_b)) then
    raise exception '% did not find its player', p_query;
  end if;
  perform public.remove_friend(p_friend);
end $$;

-- One lookup that must find nobody: its code is the function's answer, not an error, so that its line in the log stays.
create function public.test_misses(p_query text, p_code text) returns void language plpgsql as $$
declare
  said text;
begin
  perform public.test_a_second_later();
  said := public.send_friend_request(p_query);
  if said <> p_code then
    raise exception '% answered %, not %', p_query, said, p_code;
  end if;
  if exists (select 1 from public.friendships) then
    raise exception '% sent a request', p_query;
  end if;
end $$;

grant execute on function
  public.test_as(text), public.test_refuses(text, text), public.test_forbids(text), public.test_a_second_later(),
  public.test_finds(text, uuid), public.test_misses(text, text)
  to anon, authenticated;

set local role authenticated;

-- An exact tag finds, in any case, and nothing but an exact tag does.
do $$
declare
  bad text;
begin
  perform public.test_as('a');
  perform public.test_finds('Zz Riley#7687', '00000000-0000-0000-0000-00000000000b');
  perform public.test_finds('ZZ RILEY#7687', '00000000-0000-0000-0000-00000000000b');
  perform public.test_finds('zz riley#7687', '00000000-0000-0000-0000-00000000000b');
  perform public.test_finds('  Zz Riley#7687  ', '00000000-0000-0000-0000-00000000000b');
  foreach bad in array array[
    'Zz Riley#768', 'Zz Riley#07687', 'Zz Riley#7688', 'Zz Pawe#7687', 'Zz Riley #7687', 'Zz Riley', 'Zz', '#7687', 'Zz%#7687',
    'Zz P_wel#7687', '7687', '', '   '
  ] loop
    perform public.test_misses(bad, case when bad ~ '^[0-9]+$' then 'no_such_uid' else 'no_such_tag' end);
  end loop;
  perform public.test_misses(null, 'no_such_tag');
end $$;

-- A UID finds only with find_by_uid, and otherwise answers as an unknown UID does.
do $$
begin
  perform public.test_as('a');
  perform public.test_misses('9000000012', 'no_such_uid');  -- b, who did not allow it
  perform public.test_misses('9000000099', 'no_such_uid');  -- nobody
  perform public.test_misses('99999999999999999999999999', 'no_such_uid');  -- no number a UID can be
  perform public.test_finds('9000000013', '00000000-0000-0000-0000-00000000000c');  -- c, who did
  perform public.test_finds(' 9000000013 ', '00000000-0000-0000-0000-00000000000c');
end $$;

-- A lookup says nothing more: a stranger found by a request still can't read the profile.
do $$
declare
  number bigint;
begin
  perform public.test_as('a');
  perform public.test_a_second_later();
  perform public.send_friend_request('Zz Riley#7687');
  select count(*) into number from public.profiles where user_id = '00000000-0000-0000-0000-00000000000b';
  if number <> 0 then
    raise exception 'a pending request opened the profile';
  end if;
  perform public.remove_friend('00000000-0000-0000-0000-00000000000b');
end $$;

-- A second lookup within a second is lookup_limit, after one that found somebody.
do $$
begin
  perform public.test_as('a');
  perform public.test_a_second_later();
  perform public.send_friend_request('Zz Riley#7687');
  perform public.test_refuses($q$select public.send_friend_request('Zzkira#1003')$q$, 'lookup_limit');
  perform public.remove_friend('00000000-0000-0000-0000-00000000000b');
end $$;

-- And after one that found nobody, whose line has to stay, or the limit would not count the very lookups it is for. A
-- caught raise here would undo its own block alone, and hide what a raise does to a real call: it takes the whole call
-- back. So these two prove the answer itself (test_misses, where no error is caught) and the line left behind.
do $$
begin
  perform public.test_as('a');
  perform public.test_misses('Nobody#0001', 'no_such_tag');
  perform public.test_as('b');
  perform public.test_misses('9000000099', 'no_such_uid');
end $$;
reset role;
do $$
begin
  if not exists (select 1 from private.lookup_log where user_id = '00000000-0000-0000-0000-00000000000a' and at = now()) then
    raise exception 'a lookup that found no tag left no line in the log';
  end if;
  if not exists (select 1 from private.lookup_log where user_id = '00000000-0000-0000-0000-00000000000b' and at = now()) then
    raise exception 'a lookup that found no UID left no line in the log';
  end if;
end $$;
set local role authenticated;
do $$
begin
  perform public.test_as('a');
  perform public.test_refuses($q$select public.send_friend_request('Nobody#0002')$q$, 'lookup_limit');
  perform public.test_refuses($q$select public.send_friend_request('9000000099')$q$, 'lookup_limit');
  perform public.test_refuses($q$select public.send_friend_request('Zz Riley#7687')$q$, 'lookup_limit');
  perform public.test_as('b');
  perform public.test_refuses($q$select public.send_friend_request('Nobody#0002')$q$, 'lookup_limit');
end $$;

-- Each player has their own second.
reset role;
delete from private.lookup_log where user_id = '00000000-0000-0000-0000-00000000000b';
set local role authenticated;
do $$
begin
  perform public.test_as('b');
  if public.send_friend_request('Nobody#0003') <> 'no_such_tag' then
    raise exception 'one player''s lookup held up another''s';
  end if;
end $$;

-- A second has to pass in fact: a line of a second ago lets the next one through, and a newer one doesn't.
reset role;
update private.lookup_log set at = now() - interval '1 second' where user_id = '00000000-0000-0000-0000-00000000000a';
set local role authenticated;
do $$
begin
  perform public.test_as('a');
  if public.send_friend_request('Nobody#0004') <> 'no_such_tag' then
    raise exception 'a lookup a second later was refused';
  end if;
end $$;
reset role;
update private.lookup_log set at = now() - interval '0.9 second' where user_id = '00000000-0000-0000-0000-00000000000a';
set local role authenticated;
do $$
begin
  perform public.test_as('a');
  perform public.test_refuses($q$select public.send_friend_request('Nobody#0005')$q$, 'lookup_limit');
end $$;

-- A player's own tag, and their own UID once they allow it.
do $$
begin
  perform public.test_as('c');
  perform public.test_a_second_later();
  perform public.test_refuses($q$select public.send_friend_request('Zzkira#1003')$q$, 'own_tag');
  perform public.test_a_second_later();
  perform public.test_refuses($q$select public.send_friend_request('ZZKIRA#1003')$q$, 'own_tag');
  perform public.test_a_second_later();
  perform public.test_refuses($q$select public.send_friend_request('9000000013')$q$, 'own_tag');
end $$;

-- A UID is unique among the players who allow finding it, and only there (0004): one that nobody can be found by tells nothing of
-- who holds it. a hides 9000000011, so b can hold it too, hidden and then to be found by; then a can't allow finding it.
reset role;
update public.profiles set uid = 9000000011 where user_id = '00000000-0000-0000-0000-00000000000b';
update public.profiles set find_by_uid = true where user_id = '00000000-0000-0000-0000-00000000000b';
do $$
declare
  broken text;
begin
  update public.profiles set find_by_uid = true where user_id = '00000000-0000-0000-0000-00000000000a';
  raise exception 'two players can be found by one UID';
exception when unique_violation then
  get stacked diagnostics broken = constraint_name;
  if broken <> 'profiles_uid_findable' then
    raise exception 'a UID found by two broke %, not profiles_uid_findable', broken;
  end if;
end $$;
update public.profiles set uid = 9000000012, find_by_uid = false where user_id = '00000000-0000-0000-0000-00000000000b';
set local role authenticated;

-- set_uid is the one way a UID or its switch changes, and it counts as a lookup.
do $$
declare
  mine record;
begin
  perform public.test_as('b');
  perform public.test_forbids($q$update public.profiles set uid = 9000000099 where user_id = auth.uid()$q$);
  perform public.test_forbids($q$update public.profiles set find_by_uid = true where user_id = auth.uid()$q$);

  -- The UID a hides: b takes it hidden, then to be found by, and nothing in either answer says that a holds it.
  perform public.test_a_second_later();
  perform public.set_uid(9000000011, false);
  perform public.test_a_second_later();
  perform public.set_uid(9000000011, true);
  select p.uid, p.find_by_uid into mine from public.profiles as p where p.user_id = auth.uid();
  if mine.uid is distinct from 9000000011::bigint or mine.find_by_uid is not true then
    raise exception 'set_uid kept %', mine;
  end if;

  -- Whoever allows finding a UID first holds it for finding, which the design accepts: a lookup finds b, and a is refused it.
  perform public.test_as('c');
  perform public.test_finds('9000000011', '00000000-0000-0000-0000-00000000000b');
  perform public.test_as('a');
  perform public.test_a_second_later();
  perform public.test_refuses($q$select public.set_uid(9000000011, true)$q$, 'uid_taken');
  select p.uid, p.find_by_uid into mine from public.profiles as p where p.user_id = auth.uid();
  if mine.uid is distinct from 9000000011::bigint or mine.find_by_uid then
    raise exception 'a refused set_uid changed the profile: %', mine;
  end if;

  -- Within a second of a lookup set_uid is refused, and a lookup within a second of set_uid: they share the second.
  perform public.test_a_second_later();
  perform public.set_uid(9000000011, false);
  perform public.test_refuses($q$select public.set_uid(9000000011, false)$q$, 'lookup_limit');
  perform public.test_refuses($q$select public.send_friend_request('Zzkira#1003')$q$, 'lookup_limit');
  perform public.test_a_second_later();
  perform public.send_friend_request('Nobody#0006');
  perform public.test_refuses($q$select public.set_uid(9000000011, false)$q$, 'lookup_limit');

  -- A UID has nine or ten digits, or there is none; the switch is a true or a false.
  perform public.test_a_second_later();
  perform public.test_refuses($q$select public.set_uid(-1, false)$q$, 'invalid_uid');
  perform public.test_refuses($q$select public.set_uid(99999999, false)$q$, 'invalid_uid');
  perform public.test_refuses($q$select public.set_uid(10000000000, false)$q$, 'invalid_uid');
  perform public.test_refuses($q$select public.set_uid(9000000011, null)$q$, 'invalid_uid');
  perform public.set_uid(100000000, false);
  perform public.test_a_second_later();
  perform public.set_uid(9999999999, false);
  perform public.test_a_second_later();
  perform public.set_uid(null, false);
  select p.uid, p.find_by_uid into mine from public.profiles as p where p.user_id = auth.uid();
  if mine.uid is not null or mine.find_by_uid then
    raise exception 'set_uid with no UID kept %', mine;
  end if;

  -- Back to what the file began with.
  perform public.test_a_second_later();
  perform public.set_uid(9000000011, false);
  perform public.test_as('b');
  perform public.test_a_second_later();
  perform public.set_uid(9000000012, false);
end $$;

-- A session that is no player's.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"authenticated"}', true);
do $$
begin
  perform public.test_refuses($q$select public.set_uid(9000000011, false)$q$, 'not_signed_in');
end $$;
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  perform public.test_forbids($q$select public.set_uid(9000000011, false)$q$);
end $$;
reset role;
set local role authenticated;

-- The log is the functions' own.
do $$
begin
  perform public.test_as('a');
  perform public.test_forbids($q$select count(*) from private.lookup_log$q$);
  perform public.test_forbids($q$update private.lookup_log set at = now() - interval '1 day'$q$);
  perform public.test_forbids($q$delete from private.lookup_log$q$);
  perform public.test_forbids($q$select private.use_lookup(auth.uid())$q$);
end $$;

reset role;
do $$ begin raise exception 'ALL PASSED'; end $$;
rollback;
