-- Friend requests: who sees one, who answers it, and the limits on them. Run on the real project in a transaction that
-- never commits; it passes only when it ends in the error ALL PASSED (README.md here).
begin;

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@example.invalid'),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@example.invalid'),
  ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@example.invalid'),
  ('00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'd@example.invalid'),
  ('00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'e@example.invalid'),
  ('00000000-0000-0000-0000-00000000000f', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f@example.invalid');

insert into public.profiles (user_id, name, discriminator) values
  ('00000000-0000-0000-0000-00000000000a', 'Zznova', '1001'),
  ('00000000-0000-0000-0000-00000000000b', 'Zzriley', '1002'),
  ('00000000-0000-0000-0000-00000000000c', 'Zzkira', '1003'),
  ('00000000-0000-0000-0000-00000000000d', 'Zzmilo', '1004'),
  ('00000000-0000-0000-0000-00000000000e', 'Zzelena', '1005'),
  ('00000000-0000-0000-0000-00000000000f', 'Zzfull', '1006');

-- Who is asking, and one line for each refusal. All of it goes with the transaction.
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

grant execute on function
  public.test_as(text), public.test_refuses(text, text), public.test_forbids(text), public.test_a_second_later()
  to anon, authenticated;

set local role authenticated;

-- A request: pending, seen by the two alone, and answered only by the one who was asked.
do $$
declare
  said text;
  seen bigint;
  row_seen public.friendships;
begin
  perform public.test_as('a');
  said := public.send_friend_request('Zzriley#1002');
  if said <> 'sent' then
    raise exception 'a request answered %', said;
  end if;

  select * into strict row_seen from public.friendships;
  if row_seen.status <> 'pending' or row_seen.requested_by <> '00000000-0000-0000-0000-00000000000a'
     or row_seen.user_a <> '00000000-0000-0000-0000-00000000000a' or row_seen.user_b <> '00000000-0000-0000-0000-00000000000b' then
    raise exception 'a request is not what was asked: %', row_seen;
  end if;

  perform public.test_as('b');
  select count(*) into seen from public.friendships;
  if seen <> 1 then
    raise exception 'the one who was asked sees % rows', seen;
  end if;
  perform public.test_as('c');
  select count(*) into seen from public.friendships;
  if seen <> 0 then
    raise exception 'a stranger sees % rows', seen;
  end if;
  -- A stranger can't answer it, and the asker can't accept their own.
  perform public.test_refuses($q$select public.answer_friend_request('00000000-0000-0000-0000-00000000000a', true)$q$, 'no_such_request');
  perform public.test_refuses($q$select public.answer_friend_request('00000000-0000-0000-0000-00000000000b', true)$q$, 'no_such_request');
  perform public.test_as('a');
  perform public.test_refuses($q$select public.answer_friend_request('00000000-0000-0000-0000-00000000000b', true)$q$, 'no_such_request');
  perform public.test_refuses($q$select public.answer_friend_request('00000000-0000-0000-0000-00000000000b', false)$q$, 'no_such_request');
  select status into strict said from public.friendships;
  if said <> 'pending' then
    raise exception 'the asker changed their own request: %', said;
  end if;

  perform public.test_a_second_later();
  perform public.test_refuses($q$select public.send_friend_request('Zzriley#1002')$q$, 'already_sent');

  -- A call with no answer in it answers nothing: only a true accepts, because accepting opens the player's stats.
  perform public.test_as('b');
  perform public.test_refuses($q$select public.answer_friend_request('00000000-0000-0000-0000-00000000000a', null)$q$, 'no_such_request');
  select status into strict said from public.friendships;
  if said <> 'pending' then
    raise exception 'a null answered a request: %', said;
  end if;

  -- Decline deletes, and a can't ask b again for 30 days (0004): a request of a's within them gets the answer of a request still
  -- waiting, already_sent, and sends nothing.
  perform public.answer_friend_request('00000000-0000-0000-0000-00000000000a', false);
  select count(*) into seen from public.friendships;
  if seen <> 0 then
    raise exception 'a declined request left a row';
  end if;
  perform public.test_as('a');
  perform public.test_a_second_later();
  perform public.test_refuses($q$select public.send_friend_request('Zzriley#1002')$q$, 'already_sent');
  select count(*) into seen from public.friendships;
  if seen <> 0 then
    raise exception 'a declined player''s request was sent';
  end if;

  -- The one who declined can still ask, and asking lifts their decline. Accept, and then each side is already friends.
  perform public.test_as('b');
  perform public.test_a_second_later();
  said := public.send_friend_request('Zznova#1001');
  if said <> 'sent' then
    raise exception 'the one who declined could not ask: %', said;
  end if;
  perform public.test_as('a');
  perform public.answer_friend_request('00000000-0000-0000-0000-00000000000b', true);
  select status into strict said from public.friendships;
  if said <> 'accepted' then
    raise exception 'an accepted request is %', said;
  end if;
  perform public.test_refuses($q$select public.answer_friend_request('00000000-0000-0000-0000-00000000000b', true)$q$, 'no_such_request');
  perform public.test_a_second_later();
  perform public.test_refuses($q$select public.send_friend_request('Zzriley#1002')$q$, 'already_friends');
  perform public.test_as('b');
  perform public.test_a_second_later();
  perform public.test_refuses($q$select public.send_friend_request('Zznova#1001')$q$, 'already_friends');

  -- A third player's remove reaches nothing of theirs.
  perform public.test_as('c');
  perform public.remove_friend('00000000-0000-0000-0000-00000000000a');
  perform public.remove_friend('00000000-0000-0000-0000-00000000000b');
  perform public.test_as('a');
  select count(*) into seen from public.friendships;
  if seen <> 1 then
    raise exception 'a stranger removed a friendship';
  end if;

  -- Either side removes; the same goes for a request not yet answered, from either side.
  perform public.remove_friend('00000000-0000-0000-0000-00000000000b');
  select count(*) into seen from public.friendships;
  if seen <> 0 then
    raise exception 'remove_friend left the friendship';
  end if;
  perform public.test_a_second_later();
  perform public.send_friend_request('Zzriley#1002');
  perform public.test_as('b');
  perform public.remove_friend('00000000-0000-0000-0000-00000000000a');
  select count(*) into seen from public.friendships;
  if seen <> 0 then
    raise exception 'the one who was asked could not remove the request';
  end if;
  perform public.test_as('a');
  perform public.test_a_second_later();
  perform public.send_friend_request('Zzriley#1002');
  perform public.remove_friend('00000000-0000-0000-0000-00000000000b');
  select count(*) into seen from public.friendships;
  if seen <> 0 then
    raise exception 'the asker could not take the request back';
  end if;

  -- Asking someone who already asked me accepts it.
  perform public.test_as('c');
  perform public.test_a_second_later();
  perform public.send_friend_request('Zzmilo#1004');
  perform public.test_as('d');
  perform public.test_a_second_later();
  said := public.send_friend_request('Zzkira#1003');
  if said <> 'accepted' then
    raise exception 'asking one who had asked answered %', said;
  end if;
  select status into strict said from public.friendships;
  if said <> 'accepted' then
    raise exception 'asking one who had asked left %', said;
  end if;
end $$;

-- A decline holds for 30 days, and then it is gone (0004). It holds by tag and by invite, as by UID: each goes through
-- private.request_friend. c declines a here, and then offers a link, which a can't use either; the refusal spends nothing.
do $$
declare
  code text;
begin
  perform public.test_as('a');
  perform public.test_a_second_later();
  perform public.send_friend_request('Zzkira#1003');
  perform public.test_as('c');
  perform public.answer_friend_request('00000000-0000-0000-0000-00000000000a', false);
  code := public.make_invite();
  perform set_config('test.code', code, true);
  perform public.test_as('a');
  perform public.test_refuses(format('select public.redeem_invite(%L)', code), 'already_sent');
end $$;
reset role;
do $$
begin
  if not exists (select 1 from public.invites where code = current_setting('test.code')) then
    raise exception 'a refused redeem spent the code';
  end if;
end $$;
update private.declines set at = now() - interval '29 days'
where asker = '00000000-0000-0000-0000-00000000000a' and asked = '00000000-0000-0000-0000-00000000000c';
set local role authenticated;
do $$
begin
  perform public.test_as('a');
  perform public.test_a_second_later();
  perform public.test_refuses($q$select public.send_friend_request('Zzkira#1003')$q$, 'already_sent');
end $$;
reset role;
update private.declines set at = now() - interval '30 days'
where asker = '00000000-0000-0000-0000-00000000000a' and asked = '00000000-0000-0000-0000-00000000000c';
set local role authenticated;
do $$
declare
  said text;
begin
  perform public.test_as('a');
  perform public.test_a_second_later();
  said := public.send_friend_request('Zzkira#1003');
  if said <> 'sent' then
    raise exception 'a decline 30 days old still held: %', said;
  end if;
  perform public.remove_friend('00000000-0000-0000-0000-00000000000c');
end $$;

-- 20 requests a day. Lines older than a day don't count, and they go.
reset role;
insert into private.request_log (user_id, at)
select '00000000-0000-0000-0000-00000000000e', now() - interval '25 hours' from generate_series(1, 30);
insert into private.request_log (user_id, at)
select '00000000-0000-0000-0000-00000000000e', now() - interval '23 hours' from generate_series(1, 19);
set local role authenticated;
do $$
begin
  perform public.test_as('e');
  perform public.test_a_second_later();
  perform public.send_friend_request('Zznova#1001');  -- the twentieth
  perform public.test_a_second_later();
  perform public.test_refuses($q$select public.send_friend_request('Zzriley#1002')$q$, 'request_limit');
  perform public.test_a_second_later();
  perform public.test_refuses($q$select public.send_friend_request('Nobody#0001')$q$, 'request_limit');
  perform public.test_a_second_later();
  perform public.test_refuses($q$select public.send_friend_request('712345312')$q$, 'request_limit');
end $$;
reset role;
do $$
begin
  if (select count(*) from private.request_log where user_id = '00000000-0000-0000-0000-00000000000e') <> 20 then
    raise exception 'the request log holds % lines, not the last day''s 20',
      (select count(*) from private.request_log where user_id = '00000000-0000-0000-0000-00000000000e');
  end if;
end $$;

-- A request waits 30 days for its answer, and then it is as if it had never been sent: nobody is shown it, it can't be answered,
-- and a request between the two is a new one (0004). e's twentieth request, to a, is made a month old here.
update public.friendships set created_at = now() - interval '30 days'
where user_a = '00000000-0000-0000-0000-00000000000a' and user_b = '00000000-0000-0000-0000-00000000000e';
set local role authenticated;
do $$
declare
  said text;
  seen public.friendships;
begin
  perform public.test_as('a');
  if public.friends_overview()->'incoming' <> '[]' then
    raise exception 'a request a month old is shown: %', public.friends_overview()->'incoming';
  end if;
  perform public.test_refuses($q$select public.answer_friend_request('00000000-0000-0000-0000-00000000000e', true)$q$, 'no_such_request');
  perform public.test_a_second_later();
  said := public.send_friend_request('Zzelena#1005');
  if said <> 'sent' then
    raise exception 'a request to one whose request was a month old answered %', said;
  end if;
  select * into strict seen from public.friendships where '00000000-0000-0000-0000-00000000000e' in (user_a, user_b);
  if seen.status <> 'pending' or seen.requested_by <> auth.uid() or seen.created_at <> now() then
    raise exception 'a request a month old was not taken for a new one: %', seen;
  end if;
  perform public.remove_friend('00000000-0000-0000-0000-00000000000e');
end $$;
reset role;

-- 200 friends, on a request and on an accept, on either side of it.
insert into auth.users (id, instance_id, aud, role, email)
select
  ('00000000-0000-0000-0000-' || lpad(to_hex(4096 + n), 12, '0'))::uuid, '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'friend' || n || '@example.invalid'
from generate_series(1, 200) as n;
insert into public.profiles (user_id, name, discriminator)
select ('00000000-0000-0000-0000-' || lpad(to_hex(4096 + n), 12, '0'))::uuid, 'Zzfiller', lpad(n::text, 4, '0')
from generate_series(1, 200) as n;
insert into public.friendships (user_a, user_b, status, requested_by) values
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000f', 'pending', '00000000-0000-0000-0000-00000000000b'),
  ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000f', 'pending', '00000000-0000-0000-0000-00000000000f');
insert into public.friendships (user_a, user_b, status, requested_by)
select
  '00000000-0000-0000-0000-00000000000f', ('00000000-0000-0000-0000-' || lpad(to_hex(4096 + n), 12, '0'))::uuid, 'accepted',
  '00000000-0000-0000-0000-00000000000f'
from generate_series(1, 200) as n;
set local role authenticated;
do $$
begin
  perform public.test_as('f');
  perform public.test_a_second_later();
  perform public.test_refuses($q$select public.send_friend_request('Zzmilo#1004')$q$, 'friend_limit');
  -- Before the search, so that a lookup of theirs tells nothing (0004): a miss was the answer no_such_tag and kept its lookup, and a
  -- match was refused with a raise, which took its lookup back, so they could test tags and UIDs as fast as they liked.
  perform public.test_a_second_later();
  perform public.test_refuses($q$select public.send_friend_request('Nobody#0001')$q$, 'friend_limit');
  perform public.test_a_second_later();
  perform public.test_refuses($q$select public.send_friend_request('9000000099')$q$, 'friend_limit');
  perform public.test_refuses($q$select public.answer_friend_request('00000000-0000-0000-0000-00000000000b', true)$q$, 'friend_limit');
  perform public.test_a_second_later();  -- asking one who had asked accepts too, and the limit holds there
  perform public.test_refuses($q$select public.send_friend_request('Zzriley#1002')$q$, 'friend_limit');
  perform public.test_as('c');  -- the one who asked is the one who is full
  perform public.test_refuses($q$select public.answer_friend_request('00000000-0000-0000-0000-00000000000f', true)$q$, 'friend_limit');
  perform public.test_a_second_later();
  perform public.test_refuses($q$select public.send_friend_request('Zzfull#1006')$q$, 'friend_limit');
end $$;
reset role;
delete from public.friendships
where user_a = '00000000-0000-0000-0000-00000000000f'
  and user_b = ('00000000-0000-0000-0000-' || lpad(to_hex(4096 + 200), 12, '0'))::uuid;
set local role authenticated;
do $$
begin
  perform public.test_as('f');  -- 199 friends: one more fits
  perform public.answer_friend_request('00000000-0000-0000-0000-00000000000b', true);
end $$;

-- At most 50 requests wait for one player, so that requests nobody answers can't pile up for them; a request a month old doesn't
-- count (0004). 50 of the players above ask b.
reset role;
insert into public.friendships (user_a, user_b, status, requested_by)
select least('00000000-0000-0000-0000-00000000000b'::uuid, asker), greatest('00000000-0000-0000-0000-00000000000b'::uuid, asker), 'pending', asker
from (select ('00000000-0000-0000-0000-' || lpad(to_hex(4096 + n), 12, '0'))::uuid as asker from generate_series(1, 50) as n) as askers;
set local role authenticated;
do $$
begin
  perform public.test_as('a');
  perform public.test_a_second_later();
  perform public.test_refuses($q$select public.send_friend_request('Zzriley#1002')$q$, 'incoming_full');
end $$;
reset role;
update public.friendships set created_at = now() - interval '30 days'
where user_a = '00000000-0000-0000-0000-00000000000b'
  and user_b = ('00000000-0000-0000-0000-' || lpad(to_hex(4096 + 1), 12, '0'))::uuid;
set local role authenticated;
do $$
declare
  said text;
begin
  perform public.test_as('a');
  perform public.test_a_second_later();
  said := public.send_friend_request('Zzriley#1002');
  if said <> 'sent' then
    raise exception 'a request past one a month old answered %', said;
  end if;
end $$;
reset role;
do $$
begin
  -- 50 wait for b now, a's and 49 of the fillers', all fresh. The one a month old counts for nothing, and it is still there: a call
  -- writes no friendship but that of its own two players.
  if (
    select count(*) from public.friendships
    where status = 'pending' and '00000000-0000-0000-0000-00000000000b' in (user_a, user_b)
      and created_at > now() - interval '30 days'
  ) <> 50 then
    raise exception 'the requests that wait for b are not 50 fresh ones';
  end if;
  if not exists (
    select 1 from public.friendships
    where user_a = '00000000-0000-0000-0000-00000000000b'
      and user_b = ('00000000-0000-0000-0000-' || lpad(to_hex(4096 + 1), 12, '0'))::uuid and status = 'pending'
  ) then
    raise exception 'a request deleted the request of two other players';
  end if;
end $$;
set local role authenticated;

-- A client can't write the table, in any way, or reach the logs, or read its rows' system columns (0004).
do $$
begin
  perform public.test_as('a');
  perform public.test_forbids($q$select xmin, xmax from public.friendships$q$);
  perform public.test_forbids($q$select ctid from public.friendships$q$);
  perform public.test_forbids($q$insert into public.friendships (user_a, user_b, status, requested_by) values
    ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000e', 'accepted', '00000000-0000-0000-0000-00000000000a')$q$);
  perform public.test_forbids($q$update public.friendships set status = 'accepted'$q$);
  perform public.test_forbids($q$delete from public.friendships$q$);
  perform public.test_forbids($q$select count(*) from private.request_log$q$);
  perform public.test_forbids($q$select count(*) from private.lookup_log$q$);
  perform public.test_forbids($q$insert into private.request_log (user_id) values ('00000000-0000-0000-0000-00000000000a')$q$);
  perform public.test_forbids($q$delete from private.request_log$q$);
  perform public.test_forbids($q$select count(*) from private.declines$q$);
  perform public.test_forbids($q$delete from private.declines$q$);
  -- Nor run the helpers that the definer functions call.
  perform public.test_forbids($q$select private.request_friend('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b')$q$);
  perform public.test_forbids($q$select private.request_allowed('00000000-0000-0000-0000-00000000000a')$q$);
  perform public.test_forbids($q$select private.friend_count('00000000-0000-0000-0000-00000000000a')$q$);
end $$;

-- Without a session: the table and every function are refused.
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  perform public.test_forbids($q$select count(*) from public.friendships$q$);
  perform public.test_forbids($q$select public.send_friend_request('Zznova#1001')$q$);
  perform public.test_forbids($q$select public.answer_friend_request('00000000-0000-0000-0000-00000000000a', true)$q$);
  perform public.test_forbids($q$select public.remove_friend('00000000-0000-0000-0000-00000000000a')$q$);
end $$;
reset role;

-- Delete my online data takes the friendships and the logs with it, and the declines either way.
insert into private.declines (asker, asked) values
  ('00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000e');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);
do $$
begin
  perform public.delete_my_account();
end $$;
reset role;
do $$
begin
  if exists (
    select 1 from public.friendships
    where '00000000-0000-0000-0000-00000000000e' in (user_a, user_b, requested_by)
  ) then
    raise exception 'delete_my_account left a friendship';
  end if;
  if exists (select 1 from private.request_log where user_id = '00000000-0000-0000-0000-00000000000e') then
    raise exception 'delete_my_account left the request log';
  end if;
  if exists (select 1 from private.lookup_log where user_id = '00000000-0000-0000-0000-00000000000e') then
    raise exception 'delete_my_account left the lookup log';
  end if;
  if exists (select 1 from private.declines where '00000000-0000-0000-0000-00000000000e' in (asker, asked)) then
    raise exception 'delete_my_account left a decline';
  end if;
end $$;

-- The shape of it: row level security, the definer functions, the grants and what the policy of profiles calls.
do $$
declare
  name text;
  role_name text;
begin
  if not (select relrowsecurity from pg_catalog.pg_class where oid = 'public.friendships'::regclass) then
    raise exception 'friendships has row level security off';
  end if;
  if has_table_privilege('authenticated', 'public.friendships', 'insert,update,delete,truncate,references,trigger') then
    raise exception 'authenticated holds more of friendships than select';
  end if;
  -- And that select is column by column, so that no client selects the system columns (0004).
  if has_table_privilege('authenticated', 'public.friendships', 'select') then
    raise exception 'authenticated reads the whole table of friendships, system columns and all';
  end if;
  foreach name in array array['user_a', 'user_b', 'status', 'requested_by', 'created_at'] loop
    if not has_column_privilege('authenticated', 'public.friendships', name, 'select') then
      raise exception 'authenticated cannot read %', name;
    end if;
  end loop;
  foreach role_name in array array['anon', 'service_role'] loop
    if has_table_privilege(role_name, 'public.friendships', 'select,insert,update,delete,truncate,references,trigger') then
      raise exception '% holds a part of friendships', role_name;
    end if;
    if has_schema_privilege(role_name, 'private', 'usage') then
      raise exception '% can reach the private schema', role_name;
    end if;
  end loop;

  foreach name in array array[
    'public.send_friend_request(text)', 'public.answer_friend_request(uuid,boolean)', 'public.remove_friend(uuid)',
    'private.is_friend(uuid)', 'private.pending_cards()', 'private.switched_on(text)', 'private.friend_ids()'
  ] loop
    if not (select prosecdef from pg_catalog.pg_proc where oid = name::regprocedure) then
      raise exception '% is not security definer', name;
    end if;
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

  foreach name in array array[
    'private.request_friend(uuid,uuid)', 'private.request_allowed(uuid)', 'private.friend_count(uuid)'
  ] loop
    if (select proconfig from pg_catalog.pg_proc where oid = name::regprocedure) is distinct from array['search_path=""'] then
      raise exception '% does not set an empty search_path', name;
    end if;
    foreach role_name in array array['anon', 'authenticated', 'service_role', 'public'] loop
      if has_function_privilege(role_name, name, 'execute') then
        raise exception '% can run %', role_name, name;
      end if;
    end loop;
  end loop;

  -- The declines are the functions' own, as the logs are (0004).
  foreach role_name in array array['authenticated', 'anon', 'service_role', 'public'] loop
    if has_table_privilege(role_name, 'private.declines', 'select,insert,update,delete,truncate,references,trigger') then
      raise exception '% holds a part of private.declines', role_name;
    end if;
  end loop;

  -- 0002 changes the policy of 0001 and adds no second one.
  if (select count(*) from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'profiles' and cmd = 'SELECT') <> 1 then
    raise exception 'profiles has more than one select policy';
  end if;

  -- The three policies that let friends read ask private.friend_ids once a statement, and not private.is_friend for every row: a
  -- definer function with a SET is never inlined (0004).
  if (
    select count(*) from pg_catalog.pg_policies
    where schemaname = 'public' and policyname in ('profiles_select', 'shared_stats_select', 'presence_select')
      and cmd = 'SELECT' and qual ~ 'private\.friend_ids\(\)' and qual !~ 'is_friend'
  ) <> 3 then
    raise exception 'a policy of friends asks for each row whether its player is a friend';
  end if;
  if (select provolatile::text from pg_catalog.pg_proc where oid = 'private.friend_ids()'::regprocedure) <> 's' then
    raise exception 'private.friend_ids is not stable';
  end if;
end $$;

do $$ begin raise exception 'ALL PASSED'; end $$;
rollback;
