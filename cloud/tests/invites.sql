-- Invite links: a code that shows who it is from, and sends a request only when it is redeemed, once. Run on the real
-- project in a transaction that never commits; it passes only when it ends in the error ALL PASSED (README.md here).
begin;

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@example.invalid'),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@example.invalid'),
  ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@example.invalid');

insert into public.profiles (user_id, name, discriminator, ar, uid, picture_url) values
  ('00000000-0000-0000-0000-00000000000a', 'Zznova', '1001', 58, 9000000011, 'https://upload-static.hoyoverse.com/a.png'),
  ('00000000-0000-0000-0000-00000000000b', 'Zzriley', '1002', null, null, null),
  ('00000000-0000-0000-0000-00000000000c', 'Zzkira', '1003', 30, null, null);

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

grant execute on function public.test_as(text), public.test_refuses(text, text), public.test_forbids(text) to anon, authenticated;

set local role authenticated;

-- A client can't read or write the table.
do $$
begin
  perform public.test_as('a');
  perform public.test_forbids($q$select count(*) from public.invites$q$);
  perform public.test_forbids($q$insert into public.invites (code, user_id) values ('0123456789abcdef', auth.uid())$q$);
  perform public.test_forbids($q$update public.invites set expires_at = now()$q$);
  perform public.test_forbids($q$delete from public.invites$q$);
end $$;

-- peek_invite says who it is from and does nothing else. redeem_invite sends one request and spends the code.
do $$
declare
  code text;
  other text;
  seen jsonb;
  said text;
  number bigint;
begin
  perform public.test_as('a');
  code := public.make_invite();
  other := public.make_invite();
  if code !~ '^[A-Za-z0-9_-]{24}$' or code = other then
    raise exception 'the codes are % and %', code, other;
  end if;

  perform public.test_as('b');
  seen := public.peek_invite(code);
  if seen <> '{"name": "Zznova", "tag": "1001", "has_picture": true, "ar": 58}' then
    raise exception 'peek_invite gave %', seen;
  end if;
  seen := public.peek_invite(code);  -- looking twice is still only looking
  select count(*) into number from public.friendships;
  if number <> 0 then
    raise exception 'peek_invite sent a request';
  end if;

  said := public.redeem_invite(code);
  if said <> 'sent' then
    raise exception 'redeem_invite answered %', said;
  end if;
  select count(*) into number from public.friendships
  where status = 'pending' and requested_by = '00000000-0000-0000-0000-00000000000b';
  if number <> 1 then
    raise exception 'redeem_invite did not send one request from the one who redeemed it';
  end if;

  -- A code works once, for anybody.
  perform public.test_refuses(format('select public.redeem_invite(%L)', code), 'invite_gone');
  perform public.test_refuses(format('select public.peek_invite(%L)', code), 'invite_gone');
  perform public.test_as('c');
  perform public.test_refuses(format('select public.peek_invite(%L)', code), 'invite_gone');
  perform public.test_refuses(format('select public.redeem_invite(%L)', code), 'invite_gone');

  -- A player's own invite.
  perform public.test_as('a');
  perform public.test_refuses(format('select public.peek_invite(%L)', other), 'own_tag');
  perform public.test_refuses(format('select public.redeem_invite(%L)', other), 'own_tag');

  -- A code that was never made.
  perform public.test_refuses($q$select public.peek_invite('0123456789abcdef0123')$q$, 'invite_gone');
  perform public.test_refuses($q$select public.redeem_invite('0123456789abcdef0123')$q$, 'invite_gone');
  perform public.test_refuses($q$select public.peek_invite(null)$q$, 'invite_gone');

  -- A refused redeem spends nothing: b is a friend by now, and the code still works for c.
  perform public.answer_friend_request('00000000-0000-0000-0000-00000000000b', true);
  perform public.test_as('b');
  perform public.test_refuses(format('select public.redeem_invite(%L)', other), 'already_friends');
  perform public.test_as('c');
  seen := public.peek_invite(other);
  if seen->>'tag' <> '1001' then
    raise exception 'a refused redeem spent the code';
  end if;

  -- One the inviter had already asked is accepted by the link.
  perform public.test_as('a');
  perform public.send_friend_request('Zzkira#1003');
  perform public.test_as('c');
  said := public.redeem_invite(other);
  if said <> 'accepted' then
    raise exception 'redeeming the invite of one who had asked answered %', said;
  end if;
  select status into strict said from public.friendships;
  if said <> 'accepted' then
    raise exception 'redeeming the invite of one who had asked left %', said;
  end if;
  perform public.test_refuses(format('select public.peek_invite(%L)', other), 'invite_gone');
end $$;

-- An expired code.
do $$
begin
  perform public.test_as('c');
  perform set_config('test.code', public.make_invite(), true);
end $$;
reset role;
do $$
begin
  if not exists (
    select 1 from public.invites
    where user_id = '00000000-0000-0000-0000-00000000000c' and expires_at = now() + interval '7 days'
  ) then
    raise exception 'an invite does not last seven days';
  end if;
end $$;
update public.invites set expires_at = now() where user_id = '00000000-0000-0000-0000-00000000000c';
set local role authenticated;
do $$
begin
  perform public.test_as('b');
  perform public.test_refuses(format('select public.peek_invite(%L)', current_setting('test.code')), 'invite_gone');
  perform public.test_refuses(format('select public.redeem_invite(%L)', current_setting('test.code')), 'invite_gone');
  -- A player's next invite clears away their expired ones.
  perform public.test_as('c');
  perform set_config('test.code', public.make_invite(), true);
end $$;
reset role;

-- The first request sent by a link counted as a request, and the one that accepted didn't. Past 20, a link can't send one.
do $$
begin
  if (select count(*) from public.invites where user_id = '00000000-0000-0000-0000-00000000000c') <> 1 then
    raise exception 'an expired invite stayed';
  end if;
  if (select count(*) from private.request_log where user_id = '00000000-0000-0000-0000-00000000000b') <> 1 then
    raise exception 'a request sent by a link was not counted';
  end if;
  if exists (select 1 from private.request_log where user_id = '00000000-0000-0000-0000-00000000000c') then
    raise exception 'an accept by a link was counted as a request';
  end if;
end $$;
delete from public.friendships where '00000000-0000-0000-0000-00000000000b' in (user_a, user_b);
insert into private.request_log (user_id)
select '00000000-0000-0000-0000-00000000000b' from generate_series(1, 19);
set local role authenticated;
do $$
begin
  perform public.test_as('b');
  perform public.test_refuses(format('select public.redeem_invite(%L)', current_setting('test.code')), 'request_limit');
  if public.peek_invite(current_setting('test.code'))->>'tag' <> '1003' then  -- a refused redeem spends nothing
    raise exception 'a redeem past the limit spent the code';
  end if;
end $$;

-- At most 20 codes wait for one player: the oldest goes, so that no client can grow the table without end.
do $$
begin
  perform public.test_as('b');
  perform public.make_invite() from generate_series(1, 25);
end $$;
reset role;
do $$
begin
  if (select count(*) from public.invites where user_id = '00000000-0000-0000-0000-00000000000b') <> 20 then
    raise exception 'a player holds % codes, not the last 20',
      (select count(*) from public.invites where user_id = '00000000-0000-0000-0000-00000000000b');
  end if;
  perform set_config(
    'test.oldest',
    (select code from public.invites where user_id = '00000000-0000-0000-0000-00000000000b' order by code limit 1),
    true
  );
  update public.invites set expires_at = now() + interval '1 day' where code = current_setting('test.oldest');
end $$;
set local role authenticated;
do $$
begin
  perform public.test_as('b');
  perform public.make_invite();
end $$;
reset role;
do $$
begin
  if (select count(*) from public.invites where user_id = '00000000-0000-0000-0000-00000000000b') <> 20 then
    raise exception 'one code more made % codes',
      (select count(*) from public.invites where user_id = '00000000-0000-0000-0000-00000000000b');
  end if;
  if exists (select 1 from public.invites where code = current_setting('test.oldest')) then
    raise exception 'the oldest code stayed';
  end if;
end $$;

-- Without a session: the table and every function are refused.
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  perform public.test_forbids($q$select count(*) from public.invites$q$);
  perform public.test_forbids($q$select public.make_invite()$q$);
  perform public.test_forbids($q$select public.peek_invite('0123456789abcdef0123')$q$);
  perform public.test_forbids($q$select public.redeem_invite('0123456789abcdef0123')$q$);
end $$;
reset role;

-- Delete my online data takes the invites with it.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
do $$
begin
  perform public.delete_my_account();
end $$;
reset role;

-- The shape of it.
do $$
declare
  name text;
  role_name text;
begin
  if exists (select 1 from public.invites where user_id = '00000000-0000-0000-0000-00000000000c') then
    raise exception 'delete_my_account left an invite';
  end if;
  if not (select relrowsecurity from pg_catalog.pg_class where oid = 'public.invites'::regclass) then
    raise exception 'invites has row level security off';
  end if;
  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    if has_table_privilege(role_name, 'public.invites', 'select,insert,update,delete,truncate,references,trigger') then
      raise exception '% holds a part of invites', role_name;
    end if;
  end loop;

  foreach name in array array['public.make_invite()', 'public.peek_invite(text)', 'public.redeem_invite(text)'] loop
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
end $$;

do $$ begin raise exception 'ALL PASSED'; end $$;
rollback;
