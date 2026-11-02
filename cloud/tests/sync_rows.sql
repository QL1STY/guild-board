-- What sync keeps: a player's own rows, the newest edit winning, row by row, and nothing of them for anyone else, within the
-- limits of a player and the places of the project. Run on the real project in a transaction that never commits; it passes only
-- when it ends in the error ALL PASSED (README.md here).
begin;

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@example.invalid'),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@example.invalid'),
  ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@example.invalid');

-- a and c are friends, which gives c no more of a's rows than b has: b is a stranger to both.
insert into public.profiles (user_id, name, discriminator) values
  ('00000000-0000-0000-0000-00000000000a', 'Zzsyncola', '4001'),
  ('00000000-0000-0000-0000-00000000000b', 'Zzsyncriley', '4002'),
  ('00000000-0000-0000-0000-00000000000c', 'Zzsynckira', '4003');
insert into public.friendships (user_a, user_b, status, requested_by) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000c', 'accepted', '00000000-0000-0000-0000-00000000000a');

-- The places of the project (0005) are not what this file proves until its block below, and a project whose places are taken would
-- refuse the first call of a, b and c: they are left open here, and the block sets them as it needs them.
update private.limits set sync_seats = 1000000;

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

-- A refusal of the table itself, by its SQLSTATE. What this raises of its own is P0001, which is no state asked for here.
create function public.test_raises(p_call text, p_state text) returns void language plpgsql as $$
begin
  execute p_call;
  raise exception 'this went through: %', p_call;
exception when others then
  if sqlstate <> p_state then
    raise;
  end if;
end $$;

-- One row as a PC sends it.
create function public.test_row(
  p_kind text, p_key text, p_data jsonb, p_edited timestamptz, p_deleted boolean default false, p_device text default 'device-1'
) returns jsonb language sql as $$
  select jsonb_build_object(
    'kind', p_kind, 'row_key', p_key, 'data', p_data, 'deleted', p_deleted, 'edited_at', p_edited, 'device_id', p_device
  )
$$;

grant execute on function
  public.test_as(text), public.test_refuses(text, text), public.test_forbids(text), public.test_raises(text, text),
  public.test_row(text, text, jsonb, timestamptz, boolean, text)
  to anon, authenticated;

set local role authenticated;

-- The newest edit wins. A new row goes in, a newer edit replaces it, an older one is not kept and the count says so, and a
-- tie goes to the one that arrives later.
do $$
declare
  base constant timestamptz := now() - interval '3 hours';
  kept integer;
  stored public.sync_rows;
begin
  perform public.test_as('a');

  kept := public.sync_push(jsonb_build_array(
    public.test_row('achievement_progress', '[1402]', '{"status": "in_progress"}', base, false, 'device-1')
  ));
  if kept <> 1 then
    raise exception 'a new row was counted as %', kept;
  end if;
  select * into strict stored from public.sync_rows where kind = 'achievement_progress' and row_key = '[1402]';
  if stored.user_id <> auth.uid() or stored.data <> '{"status": "in_progress"}' or stored.deleted or stored.edited_at <> base
     or stored.device_id <> 'device-1' or stored.received_at <> now() then
    raise exception 'a new row is stored as %', stored;
  end if;

  kept := public.sync_push(jsonb_build_array(
    public.test_row('achievement_progress', '[1402]', '{"status": "done"}', base + interval '1 minute', false, 'device-2')
  ));
  select * into strict stored from public.sync_rows where kind = 'achievement_progress' and row_key = '[1402]';
  if kept <> 1 or stored.data <> '{"status": "done"}' or stored.edited_at <> base + interval '1 minute' or stored.device_id <> 'device-2' then
    raise exception 'a newer edit did not win: % kept, %', kept, stored;
  end if;

  kept := public.sync_push(jsonb_build_array(
    public.test_row('achievement_progress', '[1402]', '{"status": "not_started"}', base - interval '1 hour', false, 'device-3')
  ));
  select * into strict stored from public.sync_rows where kind = 'achievement_progress' and row_key = '[1402]';
  if kept <> 0 or stored.data <> '{"status": "done"}' or stored.device_id <> 'device-2' then
    raise exception 'an older edit was kept: % kept, %', kept, stored;
  end if;

  kept := public.sync_push(jsonb_build_array(
    public.test_row('achievement_progress', '[1402]', '{"status": "in_progress"}', base + interval '1 minute', false, 'device-3')
  ));
  select * into strict stored from public.sync_rows where kind = 'achievement_progress' and row_key = '[1402]';
  if kept <> 1 or stored.data <> '{"status": "in_progress"}' or stored.device_id <> 'device-3' then
    raise exception 'a tie did not go to the later arrival: % kept, %', kept, stored;
  end if;

  -- Each row of a call is judged alone, and the count is of those kept.
  kept := public.sync_push(jsonb_build_array(
    public.test_row('wishlist', '["one"]', '{"v": 1}', base),
    public.test_row('wishlist', '["two"]', '{"v": 1}', base)
  ));
  if kept <> 2 then
    raise exception 'two new rows were counted as %', kept;
  end if;
  kept := public.sync_push(jsonb_build_array(
    public.test_row('wishlist', '["one"]', '{"v": 2}', base - interval '1 minute'),
    public.test_row('wishlist', '["two"]', '{"v": 2}', base + interval '1 minute'),
    public.test_row('wishlist', '["three"]', '{"v": 2}', base - interval '1 day')
  ));
  if kept <> 2 then
    raise exception 'a call of one older, one newer and one new row was counted as %', kept;
  end if;
  if (select data from public.sync_rows where kind = 'wishlist' and row_key = '["one"]') <> '{"v": 1}'
     or (select data from public.sync_rows where kind = 'wishlist' and row_key = '["two"]') <> '{"v": 2}'
     or not exists (select 1 from public.sync_rows where kind = 'wishlist' and row_key = '["three"]') then
    raise exception 'a call kept the wrong rows of its three';
  end if;

  -- The same key twice in one call is one row: the newer.
  kept := public.sync_push(jsonb_build_array(
    public.test_row('wishlist', '["twice"]', '{"v": "new"}', base + interval '2 minutes'),
    public.test_row('wishlist', '["twice"]', '{"v": "old"}', base + interval '1 minute')
  ));
  if kept <> 1 or (select data from public.sync_rows where kind = 'wishlist' and row_key = '["twice"]') <> '{"v": "new"}' then
    raise exception 'the same key twice in a call was counted as %', kept;
  end if;
end $$;

-- A clock that is wrong can win for five minutes and not for a year: an edit more than five minutes ahead of the server is
-- kept as five minutes ahead. One within them is kept as it was sent.
do $$
declare
  kept integer;
  stored public.sync_rows;
begin
  perform public.test_as('a');
  perform public.sync_push(jsonb_build_array(public.test_row('layouts', 'board', '{"widgets": "wrong clock"}', now() + interval '1 year')));
  select * into strict stored from public.sync_rows where kind = 'layouts' and row_key = 'board';
  if stored.edited_at <> now() + interval '5 minutes' then
    raise exception 'an edit a year ahead was kept as %', stored.edited_at;
  end if;
  perform public.sync_push(jsonb_build_array(public.test_row('layouts', 'overlay', '{"widgets": "ahead a little"}', now() + interval '4 minutes')));
  if (select edited_at from public.sync_rows where kind = 'layouts' and row_key = 'overlay') <> now() + interval '4 minutes' then
    raise exception 'an edit four minutes ahead was changed';
  end if;

  -- For the five minutes an honest edit is older than that row.
  kept := public.sync_push(jsonb_build_array(public.test_row('layouts', 'board', '{"widgets": "honest"}', now())));
  if kept <> 0 then
    raise exception 'an honest edit won against a clock a year ahead at once';
  end if;
end $$;

-- The five minutes pass.
reset role;
update public.sync_rows set edited_at = edited_at - interval '10 minutes'
  where user_id = '00000000-0000-0000-0000-00000000000a' and kind = 'layouts' and row_key = 'board';
set local role authenticated;
do $$
declare
  kept integer;
begin
  perform public.test_as('a');
  kept := public.sync_push(jsonb_build_array(public.test_row('layouts', 'board', '{"widgets": "honest"}', now())));
  if kept <> 1 or (select data from public.sync_rows where kind = 'layouts' and row_key = 'board') <> '{"widgets": "honest"}' then
    raise exception 'an honest edit did not win once the wrong clock''s five minutes had passed';
  end if;
end $$;

-- A delete is a row. It keeps no data, whatever was sent; a newer edit brings the row back.
do $$
declare
  base constant timestamptz := now() - interval '2 hours';
  stored public.sync_rows;
begin
  perform public.test_as('a');
  perform public.sync_push(jsonb_build_array(public.test_row('timers', '["k1"]', '{"name": "Teapot"}', base)));
  perform public.sync_push(jsonb_build_array(public.test_row('timers', '["k1"]', '{"name": "Teapot"}', base + interval '1 minute', true)));
  select * into strict stored from public.sync_rows where kind = 'timers' and row_key = '["k1"]';
  if not stored.deleted or stored.data <> '{}' then
    raise exception 'a delete is stored as %', stored;
  end if;

  -- A delete with no data at all is one too, and a row with no `deleted` is not a delete.
  perform public.sync_push(jsonb_build_array(
    jsonb_build_object('kind', 'timers', 'row_key', '["k2"]', 'deleted', true, 'edited_at', base, 'device_id', 'device-1'),
    jsonb_build_object('kind', 'timers', 'row_key', '["k3"]', 'data', '{"name": "Fish"}'::jsonb, 'edited_at', base, 'device_id', 'device-1')
  ));
  select * into strict stored from public.sync_rows where kind = 'timers' and row_key = '["k2"]';
  if not stored.deleted or stored.data <> '{}' then
    raise exception 'a delete with no data is stored as %', stored;
  end if;
  select * into strict stored from public.sync_rows where kind = 'timers' and row_key = '["k3"]';
  if stored.deleted or stored.data <> '{"name": "Fish"}' then
    raise exception 'a row with no deleted is stored as %', stored;
  end if;

  perform public.sync_push(jsonb_build_array(public.test_row('timers', '["k1"]', '{"name": "Teapot, again"}', base + interval '2 minutes')));
  select * into strict stored from public.sync_rows where kind = 'timers' and row_key = '["k1"]';
  if stored.deleted or stored.data <> '{"name": "Teapot, again"}' then
    raise exception 'a newer edit did not bring a deleted row back: %', stored;
  end if;
end $$;

-- The user in a row says nothing, and neither does the arrival: both are the server's.
do $$
declare
  base constant timestamptz := now() - interval '2 hours';
  stored public.sync_rows;
begin
  perform public.test_as('a');
  perform public.sync_push(jsonb_build_array(
    public.test_row('widget_data', 'resin', '{"x": 1}', base)
    || '{"user_id": "00000000-0000-0000-0000-00000000000b", "received_at": "2000-01-01T00:00:00Z"}'
  ));
  select * into strict stored from public.sync_rows where kind = 'widget_data' and row_key = 'resin';
  if stored.user_id <> auth.uid() or stored.received_at <> now() then
    raise exception 'a row took its user or its arrival from the call: %', stored;
  end if;
end $$;
reset role;
do $$
begin
  if exists (select 1 from public.sync_rows where user_id = '00000000-0000-0000-0000-00000000000b') then
    raise exception 'a call wrote a row for another user';
  end if;
end $$;
set local role authenticated;

-- What a row and a call may be. A row is at most 262,144 bytes and an object; a call is an array of at most 500 rows, each with
-- all it needs.
do $$
declare
  base constant timestamptz := now() - interval '2 hours';
  kept integer;
begin
  perform public.test_as('a');

  perform public.sync_push(jsonb_build_array(public.test_row('layouts', 'big-fits', jsonb_build_object('x', repeat('x', 200000)), base)));
  -- All of a call is judged before anything is written, each thing a constraint of the table would refuse: a call that failed after
  -- writing would leave its bulk on the disk, counted by nothing.
  perform public.test_refuses(
    $q$select public.sync_push(jsonb_build_array(public.test_row('layouts', 'big', jsonb_build_object('x', repeat('x', 300000)), now() - interval '2 hours')))$q$,
    'bad_rows'
  );
  perform public.test_refuses($q$select public.sync_push(jsonb_build_array(public.test_row('layouts', 'list', '[1]', now() - interval '2 hours')))$q$, 'bad_rows');
  perform public.test_refuses($q$select public.sync_push(jsonb_build_array(public.test_row('layouts', 'text', '"x"', now() - interval '2 hours')))$q$, 'bad_rows');
  perform public.test_refuses(
    $q$select public.sync_push(jsonb_build_array(public.test_row('layouts', repeat('k', 201), '{}', now() - interval '2 hours')))$q$, 'bad_rows'
  );
  perform public.test_refuses($q$select public.sync_push(jsonb_build_array(public.test_row('layouts', '', '{}', now() - interval '2 hours')))$q$, 'bad_rows');
  perform public.test_refuses(
    $q$select public.sync_push(jsonb_build_array(public.test_row('layouts', 'device', '{}', now() - interval '2 hours', false, repeat('d', 65))))$q$,
    'bad_rows'
  );
  perform public.test_refuses(
    $q$select public.sync_push(jsonb_build_array(public.test_row('layouts', 'device', '{}', now() - interval '2 hours', false, '')))$q$, 'bad_rows'
  );
  perform public.test_refuses(
    $q$select public.sync_push(jsonb_build_array(public.test_row(repeat('k', 41), 'kind', '{}', now() - interval '2 hours')))$q$, 'bad_rows'
  );
  perform public.test_refuses($q$select public.sync_push(jsonb_build_array(public.test_row('', 'kind', '{}', now() - interval '2 hours')))$q$, 'bad_rows');
  if exists (select 1 from public.sync_rows where row_key in ('big', 'list', 'text', 'device', 'kind') or kind = repeat('k', 41)) then
    raise exception 'a row the table refuses was kept';
  end if;

  -- A delete keeps no data, so what it was sent with is not judged: it is not what is written.
  kept := public.sync_push(jsonb_build_array(
    public.test_row('layouts', 'deleted-big', jsonb_build_object('x', repeat('x', 300000)), base, true),
    public.test_row('layouts', 'deleted-list', '[1]', base, true)
  ));
  if kept <> 2 or (select count(*) from public.sync_rows where row_key like 'deleted-%' and data = '{}' and deleted) <> 2 then
    raise exception 'a delete was judged by the data it was sent with';
  end if;

  -- A row that lacks what it needs refuses the call, and nothing of the call is kept.
  perform public.test_refuses(
    $q$select public.sync_push(jsonb_build_array(
      public.test_row('layouts', 'fine', '{}', now() - interval '2 hours'),
      jsonb_build_object('kind', 'layouts', 'row_key', 'no-time', 'data', '{}'::jsonb, 'device_id', 'device-1')
    ))$q$, 'bad_rows'
  );
  perform public.test_refuses(
    $q$select public.sync_push(jsonb_build_array(jsonb_build_object('row_key', 'no-kind', 'data', '{}'::jsonb, 'edited_at', now(), 'device_id', 'd')))$q$, 'bad_rows'
  );
  perform public.test_refuses(
    $q$select public.sync_push(jsonb_build_array(jsonb_build_object('kind', 'layouts', 'data', '{}'::jsonb, 'edited_at', now(), 'device_id', 'd')))$q$, 'bad_rows'
  );
  perform public.test_refuses(
    $q$select public.sync_push(jsonb_build_array(jsonb_build_object('kind', 'layouts', 'row_key', 'no-device', 'data', '{}'::jsonb, 'edited_at', now())))$q$, 'bad_rows'
  );
  perform public.test_refuses(
    $q$select public.sync_push(jsonb_build_array(jsonb_build_object('kind', 'layouts', 'row_key', 'no-data', 'edited_at', now(), 'device_id', 'd')))$q$, 'bad_rows'
  );
  if exists (select 1 from public.sync_rows where row_key in ('fine', 'no-time', 'no-kind', 'no-device', 'no-data')) then
    raise exception 'a call with a row that lacked what it needs kept a row';
  end if;

  -- The call itself.
  perform public.test_refuses($q$select public.sync_push(null)$q$, 'bad_rows');
  perform public.test_refuses($q$select public.sync_push('{}')$q$, 'bad_rows');
  perform public.test_refuses($q$select public.sync_push('"rows"')$q$, 'bad_rows');
  perform public.test_refuses($q$select public.sync_push('7')$q$, 'bad_rows');
  if public.sync_push('[]') <> 0 then
    raise exception 'a call of no rows was counted';
  end if;
  -- A call that brings more than an account can hold is refused before anything of it is read (0004): each of these rows would fit
  -- a row's own limit, and the last is one that the judge of the rows would refuse with bad_rows.
  perform public.test_refuses($q$select public.sync_push((
    select jsonb_agg(public.test_row('layouts', 'huge-' || n, jsonb_build_object('x', repeat('y', 250000)), now() - interval '2 hours'))
    from generate_series(1, 17) as n
  ) || jsonb_build_array(public.test_row('layouts', repeat('k', 201), '{}', now() - interval '2 hours')))$q$, 'sync_full');

  -- 500 rows in one call work. 501 do not, and none of them is kept.
  kept := public.sync_push((
    select jsonb_agg(public.test_row('char_ticks', '["' || n || '"]', '{"done_at": "2026-10-13T08:00:00Z"}', base))
    from generate_series(1, 500) as n
  ));
  if kept <> 500 or (select count(*) from public.sync_rows where kind = 'char_ticks') <> 500 then
    raise exception '500 rows were counted as %', kept;
  end if;
  perform public.test_refuses($q$select public.sync_push((
    select jsonb_agg(public.test_row('char_held', '["' || n || '"]', '{}', now() - interval '2 hours')) from generate_series(1, 501) as n
  ))$q$, 'too_many_rows');
  if exists (select 1 from public.sync_rows where kind = 'char_held') then
    raise exception 'a call of 501 rows kept some of them';
  end if;
  -- A thousand edits again, 500 at a time, are not kept either: they are not newer.
  kept := public.sync_push((
    select jsonb_agg(public.test_row('char_ticks', '["' || n || '"]', '{"done_at": "later"}', base - interval '1 hour'))
    from generate_series(1, 500) as n
  ));
  if kept <> 0 then
    raise exception '500 older rows were counted as %', kept;
  end if;
end $$;

-- The table holds its own limits all the same, for whatever writes it as the owner.
reset role;
do $$
declare
  a constant uuid := '00000000-0000-0000-0000-00000000000a';
begin
  perform public.test_raises(format($q$insert into public.sync_rows (user_id, kind, row_key, data, edited_at, device_id)
    values (%L, 'layouts', 'big', jsonb_build_object('x', repeat('x', 300000)), now(), 'd')$q$, a), '23514');
  perform public.test_raises(format($q$insert into public.sync_rows (user_id, kind, row_key, data, edited_at, device_id)
    values (%L, 'layouts', 'list', '[1]', now(), 'd')$q$, a), '23514');
  perform public.test_raises(format($q$insert into public.sync_rows (user_id, kind, row_key, data, edited_at, device_id)
    values (%L, 'layouts', repeat('k', 201), '{}', now(), 'd')$q$, a), '23514');
  perform public.test_raises(format($q$insert into public.sync_rows (user_id, kind, row_key, data, edited_at, device_id)
    values (%L, repeat('k', 41), 'kind', '{}', now(), 'd')$q$, a), '23514');
  perform public.test_raises(format($q$insert into public.sync_rows (user_id, kind, row_key, data, edited_at, device_id)
    values (%L, 'layouts', 'device', '{}', now(), repeat('d', 65))$q$, a), '23514');
end $$;
set local role authenticated;

-- Deleted rows go once they are 90 days old by their arrival, on the next call that brings rows, and only the player's own: the age
-- of the edit says nothing, nor does a row that is not deleted. A call of no rows returns at once and does nothing (0004).
reset role;
alter table public.sync_rows disable trigger sync_rows_stamped;
insert into public.sync_rows (user_id, kind, row_key, data, deleted, edited_at, received_at, device_id) values
  ('00000000-0000-0000-0000-00000000000a', 'gift_codes', '["gone"]', '{}', true, now() - interval '100 days', now() - interval '91 days', 'device-1'),
  ('00000000-0000-0000-0000-00000000000a', 'gift_codes', '["young"]', '{}', true, now() - interval '100 days', now() - interval '89 days', 'device-1'),
  ('00000000-0000-0000-0000-00000000000a', 'gift_codes', '["live"]', '{"result": "ok"}', false, now() - interval '100 days', now() - interval '91 days', 'device-1'),
  ('00000000-0000-0000-0000-00000000000b', 'gift_codes', '["theirs"]', '{}', true, now() - interval '100 days', now() - interval '91 days', 'device-1');
alter table public.sync_rows enable trigger sync_rows_stamped;
set local role authenticated;
do $$
begin
  perform public.test_as('a');
  if (select count(*) from public.sync_rows where kind = 'gift_codes') <> 3 then
    raise exception 'the rows were not what the check began with';
  end if;
  -- Two statements, so that the count is read after the call.
  if public.sync_push('[]') <> 0 then
    raise exception 'a call of no rows was counted';
  end if;
  if (select count(*) from public.sync_rows where kind = 'gift_codes') <> 3 then
    raise exception 'a call of no rows did the work of a call: it took an old delete';
  end if;
  perform public.sync_push(jsonb_build_array(public.test_row('gift_codes', '["new"]', '{"result": "ok"}', now())));
  if exists (select 1 from public.sync_rows where kind = 'gift_codes' and row_key = '["gone"]') then
    raise exception 'a delete 91 days old stayed';
  end if;
  if (select count(*) from public.sync_rows where kind = 'gift_codes') <> 3 then
    raise exception 'a delete 89 days old, or a row that is not a delete, went';
  end if;
end $$;
reset role;
do $$
begin
  if not exists (select 1 from public.sync_rows where user_id = '00000000-0000-0000-0000-00000000000b' and row_key = '["theirs"]') then
    raise exception 'one player''s call took another''s old delete';
  end if;
end $$;
set local role authenticated;
do $$
begin
  perform public.test_as('b');
  perform public.sync_push(jsonb_build_array(public.test_row('gift_codes', '["b-new"]', '{"result": "ok"}', now())));
end $$;
reset role;
do $$
begin
  if exists (select 1 from public.sync_rows where user_id = '00000000-0000-0000-0000-00000000000b' and row_key = '["theirs"]') then
    raise exception 'a delete 91 days old stayed for the player it is';
  end if;
end $$;
-- What b wrote here goes, so that b is a stranger with no rows below.
delete from public.sync_rows where user_id = '00000000-0000-0000-0000-00000000000b';
set local role authenticated;

-- Nobody reads or writes another's rows: not a stranger, not a friend, not a session-less request.
do $$
declare
  number bigint;
begin
  perform public.test_as('a');
  select count(*) into number from public.sync_rows;
  if number < 500 then
    raise exception 'the player sees only % of their own rows', number;
  end if;
  -- Every column of them, and none of the system columns (0004).
  perform public.test_forbids($q$select xmin, xmax from public.sync_rows$q$);
  perform public.test_forbids($q$select ctid from public.sync_rows$q$);

  perform public.test_as('b');
  select count(*) into number from public.sync_rows;
  if number <> 0 then
    raise exception 'a stranger sees % rows', number;
  end if;
  perform public.test_as('c');
  select count(*) into number from public.sync_rows;
  if number <> 0 then
    raise exception 'a friend sees % rows', number;
  end if;
  select count(*) into number from public.sync_rows where user_id = '00000000-0000-0000-0000-00000000000a';
  if number <> 0 then
    raise exception 'a friend sees % of a player''s rows by name', number;
  end if;

  perform public.test_as('b');
  perform public.test_forbids($q$insert into public.sync_rows (user_id, kind, row_key, data, edited_at, device_id)
    values ('00000000-0000-0000-0000-00000000000a', 'timers', '["planted"]', '{}', now(), 'device-9')$q$);
  perform public.test_forbids($q$update public.sync_rows set data = '{"hacked": true}'$q$);
  perform public.test_forbids($q$update public.sync_rows set deleted = true, edited_at = now() where user_id = '00000000-0000-0000-0000-00000000000a'$q$);
  perform public.test_forbids($q$delete from public.sync_rows$q$);
  perform public.test_forbids($q$delete from public.sync_rows where user_id = '00000000-0000-0000-0000-00000000000a'$q$);

  -- The same kind and key from another player is a row of their own, and the first is as it was.
  number := public.sync_push(jsonb_build_array(
    public.test_row('achievement_progress', '[1402]', '{"status": "not_started"}', now() + interval '1 minute', false, 'device-b')
  ));
  if number <> 1 then
    raise exception 'a stranger''s row was counted as %', number;
  end if;
  select count(*) into number from public.sync_rows;
  if number <> 1 then
    raise exception 'a stranger sees % rows after writing one', number;
  end if;
end $$;
reset role;
do $$
begin
  if (select data from public.sync_rows where user_id = '00000000-0000-0000-0000-00000000000a' and kind = 'achievement_progress')
     <> '{"status": "in_progress"}' then
    raise exception 'a stranger''s row, newer, changed a player''s';
  end if;
  if (select count(*) from public.sync_rows where user_id = '00000000-0000-0000-0000-00000000000a' and kind in ('wishlist', 'timers', 'char_ticks')) < 500 then
    raise exception 'a stranger took a player''s rows';
  end if;
end $$;

-- Without a session: the table and the function are refused.
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  perform public.test_forbids($q$select count(*) from public.sync_rows$q$);
  perform public.test_forbids($q$select public.sync_push('[]')$q$);
  perform public.test_forbids($q$insert into public.sync_rows (user_id, kind, row_key, data, edited_at, device_id)
    values ('00000000-0000-0000-0000-00000000000a', 'timers', '["planted"]', '{}', now(), 'device-9')$q$);
  perform public.test_forbids($q$select count(*) from private.push_log$q$);
end $$;
reset role;

-- A session with no player in it, and one that outlived its player: the foreign key would refuse that one only after the rows
-- were written.
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
do $$
begin
  perform public.test_refuses($q$select public.sync_push('[]')$q$, 'not_signed_in');
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"authenticated"}', true);
do $$
begin
  perform public.test_refuses($q$select public.sync_push(jsonb_build_array(public.test_row('layouts', 'orphan', '{}', now())))$q$, 'not_signed_in');
end $$;
reset role;

-- The arrival is stamped again when a call changes a row. The trigger is off for a moment to give the row an old arrival, which
-- nothing else can: it is the one thing that tells the stamp from the time of the test.
reset role;
alter table public.sync_rows disable trigger sync_rows_stamped;
update public.sync_rows set received_at = now() - interval '1 day'
  where user_id = '00000000-0000-0000-0000-00000000000a' and kind = 'achievement_progress';
alter table public.sync_rows enable trigger sync_rows_stamped;
set local role authenticated;
do $$
begin
  perform public.test_as('a');
  if (select received_at from public.sync_rows where kind = 'achievement_progress') <> now() - interval '1 day' then
    raise exception 'the row did not begin with an old arrival';
  end if;
  perform public.sync_push(jsonb_build_array(
    public.test_row('achievement_progress', '[1402]', '{"status": "done"}', now() - interval '1 hour', false, 'device-4')
  ));
  if (select received_at from public.sync_rows where kind = 'achievement_progress') <> now() then
    raise exception 'a call that changed a row did not stamp its arrival';
  end if;
end $$;

-- A call is the one way in, so that its limits hold: a player writes none of the table, not even their own rows.
do $$
begin
  perform public.test_as('a');
  perform public.test_forbids($q$update public.sync_rows set received_at = now() - interval '1 year'$q$);
  perform public.test_forbids($q$update public.sync_rows set kind = 'other'$q$);
  perform public.test_forbids($q$update public.sync_rows set row_key = '["other"]'$q$);
  perform public.test_forbids($q$update public.sync_rows set user_id = '00000000-0000-0000-0000-00000000000b'$q$);
  perform public.test_forbids($q$insert into public.sync_rows (user_id, kind, row_key, data, edited_at, received_at, device_id)
    values ('00000000-0000-0000-0000-00000000000a', 'timers', '["early"]', '{}', now(), now() - interval '1 year', 'device-9')$q$);
  perform public.test_forbids($q$truncate public.sync_rows$q$);
  perform public.test_forbids($q$insert into public.sync_rows (user_id, kind, row_key, data, edited_at, device_id)
    values ('00000000-0000-0000-0000-00000000000b', 'timers', '["planted"]', '{}', now(), 'device-9')$q$);
  perform public.test_forbids($q$insert into public.sync_rows (user_id, kind, row_key, data, edited_at, device_id)
    values ('00000000-0000-0000-0000-00000000000a', 'timers', '["mine"]', '{}', now(), 'device-9')$q$);
  perform public.test_forbids($q$update public.sync_rows set data = '{"status": "not_started"}' where kind = 'achievement_progress'$q$);
  perform public.test_forbids($q$delete from public.sync_rows where kind = 'char_ticks'$q$);
  perform public.test_forbids($q$select count(*) from private.push_log$q$);
  perform public.test_forbids($q$update private.push_log set bytes = 0$q$);
  perform public.test_forbids($q$delete from private.push_log$q$);
  perform public.test_forbids($q$select sync_total_bytes from private.limits$q$);
  perform public.test_forbids($q$update private.limits set sync_total_bytes = 1099511627776$q$);
end $$;
reset role;

-- What a player can hold: 20,000 rows (0004; 50,000 before, which 4 MiB can't reach now that a row also counts its keys again and
-- 100 bytes). A call counts all its rows, as a call cannot know which it will keep without doing the work, and one that would pass
-- the limit writes nothing. The rows are put in here as the owner, which is far quicker than calls, and c is the player of this block
-- alone.
insert into public.sync_rows (user_id, kind, row_key, data, edited_at, device_id)
select '00000000-0000-0000-0000-00000000000c', 'filler', n::text, '{}', now() - interval '1 day', 'device-1'
from generate_series(1, 19998) as n;
set local role authenticated;
do $$
declare
  kept integer;
begin
  perform public.test_as('c');
  -- These rows take well under 4 MiB as they are counted, so it is their number that refuses.
  if (
    select sum(pg_column_size(data) + 2 * (octet_length(kind) + octet_length(row_key)) + octet_length(device_id) + 100)
    from public.sync_rows
  ) > 3500000 then
    raise exception 'the rows of this test are not what it means: they fill the bytes';
  end if;
  perform public.test_refuses($q$select public.sync_push((
    select jsonb_agg(public.test_row('filler', 'new-' || n, '{}', now())) from generate_series(1, 3) as n
  ))$q$, 'sync_full');
  if (select count(*) from public.sync_rows) <> 19998 then
    raise exception 'a call past the limit of rows kept something';
  end if;
  kept := public.sync_push((
    select jsonb_agg(public.test_row('filler', 'new-' || n, '{}', now())) from generate_series(1, 2) as n
  ));
  if kept <> 2 or (select count(*) from public.sync_rows) <> 20000 then
    raise exception 'a call up to the limit of rows was counted as %', kept;
  end if;

  -- At the limit, a row more is refused, an edit of a row held counts as one, and a call of no rows is nothing more.
  perform public.test_refuses($q$select public.sync_push(jsonb_build_array(public.test_row('filler', 'one-more', '{}', now())))$q$, 'sync_full');
  perform public.test_refuses($q$select public.sync_push(jsonb_build_array(public.test_row('filler', '1', '{"edited": true}', now())))$q$, 'sync_full');
  if public.sync_push('[]') <> 0 then
    raise exception 'a call of no rows at the limit was counted';
  end if;
  if exists (select 1 from public.sync_rows where row_key = 'one-more' or data = '{"edited": true}') then
    raise exception 'a call at the limit changed a row';
  end if;
end $$;

-- An old delete does not hold a player at the limit: it goes before the rows are counted. A call that is refused all the same takes
-- nothing with it, as nothing of it is kept.
reset role;
alter table public.sync_rows disable trigger sync_rows_stamped;
update public.sync_rows set deleted = true, received_at = now() - interval '91 days'
  where user_id = '00000000-0000-0000-0000-00000000000c' and kind = 'filler' and row_key in ('1', '2');
alter table public.sync_rows enable trigger sync_rows_stamped;
set local role authenticated;
do $$
begin
  perform public.test_as('c');
  perform public.test_refuses($q$select public.sync_push((
    select jsonb_agg(public.test_row('filler', 'room-' || n, '{}', now())) from generate_series(1, 3) as n
  ))$q$, 'sync_full');
  if (select count(*) from public.sync_rows where row_key in ('1', '2')) <> 2 then
    raise exception 'a refused call kept its purge';
  end if;
  if public.sync_push((
    select jsonb_agg(public.test_row('filler', 'room-' || n, '{}', now())) from generate_series(1, 2) as n
  )) <> 2 then
    raise exception 'old deletes held a player at the limit';
  end if;
  if exists (select 1 from public.sync_rows where row_key in ('1', '2')) or (select count(*) from public.sync_rows) <> 20000 then
    raise exception 'the old deletes did not go';
  end if;
end $$;
reset role;

-- What a player can hold: 4 MiB (0004; 16 MiB before), by what their rows take and what the call brings. A row counts its data,
-- its kind and key twice, as the primary key's index holds them again, its device, and 100 bytes for what the table and its indexes
-- keep of any row. Text that does not compress, so that what is counted is what is on the disk.
delete from public.sync_rows where user_id = '00000000-0000-0000-0000-00000000000c';
insert into public.sync_rows (user_id, kind, row_key, data, edited_at, device_id)
select '00000000-0000-0000-0000-00000000000c', 'filler', page::text,
  jsonb_build_object('x', (select string_agg(md5(page::text || '-' || n::text), '') from generate_series(1, 7000) as n)),
  now() - interval '1 day', 'device-1'
from generate_series(1, 17) as page;
set local role authenticated;
do $$
declare
  room bigint;
begin
  perform public.test_as('c');
  room := 4194304 - (
    select sum(pg_column_size(data) + 2 * (octet_length(kind) + octet_length(row_key)) + octet_length(device_id) + 100)
    from public.sync_rows
  );
  if room < 100000 or room > 2000000 then
    raise exception 'the bytes of this test are not what it means: % left', room;
  end if;
  -- A call that fits the room is kept.
  if public.sync_push(jsonb_build_array(public.test_row('filler', 'fits', '{"small": true}', now()))) <> 1 then
    raise exception 'a small row was refused below the limit of bytes';
  end if;
  -- One that brings more than the room is refused, though each of its rows fits a row's own limit, and whatever the rows would take
  -- once they are compressed: this text would take next to nothing, and it is what the call brings that counts.
  perform public.test_refuses(format(
    $q$select public.sync_push((select jsonb_agg(public.test_row('filler', 'big-' || n, jsonb_build_object('x', repeat('y', 250000)), now())) from generate_series(1, %s) as n))$q$,
    room / 250000 + 1
  ), 'sync_full');
  if exists (select 1 from public.sync_rows where row_key like 'big-%') then
    raise exception 'a call past the limit of bytes kept a row';
  end if;
end $$;
reset role;

-- A row's keys are held too, and at their widest they take far more than its data: these rows hold no data, and pass what was left.
-- They pass it only as 0004 counts a row, its kind and key twice and 100 bytes more, and not by their text alone, so there are as
-- many of them as the room left takes: each holds about 1,190 bytes of text and is counted as about 2,210.
set local role authenticated;
do $$
begin
  perform public.test_as('c');
  perform set_config('test.room', (4194304 - (
    select sum(pg_column_size(data) + 2 * (octet_length(kind) + octet_length(row_key)) + octet_length(device_id) + 100)
    from public.sync_rows
  ))::text, true);
end $$;
reset role;
insert into public.sync_rows (user_id, kind, row_key, data, edited_at, device_id)
select '00000000-0000-0000-0000-00000000000c', repeat(chr(128512), 40), n::text || repeat(chr(128512), 190), '{}',
  now() - interval '1 day', repeat(chr(128512), 64)
from generate_series(1, current_setting('test.room')::bigint / 1700 + 1) as n;
set local role authenticated;
do $$
begin
  perform public.test_as('c');
  if (select sum(pg_column_size(data) + octet_length(kind) + octet_length(row_key) + octet_length(device_id)) from public.sync_rows)
     + 1000 > 4194304 then
    raise exception 'the rows of this test are not what it means: their text alone fills the room';
  end if;
  perform public.test_refuses($q$select public.sync_push(jsonb_build_array(public.test_row('filler', 'wide', '{}', now())))$q$, 'sync_full');
end $$;
reset role;
delete from public.sync_rows where user_id = '00000000-0000-0000-0000-00000000000c';

-- What a player can write in an hour: 16 MiB. Overwriting is a write too, and a dead row takes the disk until a vacuum. The count is
-- of what each call brings, and at least 16 KiB a call (0004), so that an hour holds at most 1,024 calls of a player, each of which
-- reads every row they hold: a call of a few bytes counted as what it brought, and two million of them fitted in an hour. 16,383
-- bytes are left of this hour here. A call that is refused is not counted and writes nothing, as it never reached the insert.
update private.push_log set bytes = 16777216 - 16383 where user_id = '00000000-0000-0000-0000-00000000000c';
do $$
begin
  if not exists (select 1 from private.push_log where user_id = '00000000-0000-0000-0000-00000000000c' and bytes = 16777216 - 16383) then
    raise exception 'calls that were kept left no count';
  end if;
end $$;
set local role authenticated;
do $$
begin
  perform public.test_as('c');
  perform public.test_refuses($q$select public.sync_push(jsonb_build_array(public.test_row('filler', 'small', '{}', now())))$q$, 'sync_busy');
  -- Each of this call's rows but the last is a good one.
  perform public.test_refuses($q$select public.sync_push(jsonb_build_array(
    public.test_row('filler', 'good', '{}', now()),
    public.test_row('filler', repeat('k', 201), '{}', now())
  ))$q$, 'bad_rows');
end $$;
reset role;
do $$
begin
  if exists (select 1 from public.sync_rows where user_id = '00000000-0000-0000-0000-00000000000c') then
    raise exception 'a refused call wrote a row';
  end if;
  if (select bytes from private.push_log where user_id = '00000000-0000-0000-0000-00000000000c') <> 16777216 - 16383 then
    raise exception 'a refused call was counted';
  end if;
end $$;

-- 16,384 left: a call that brings more is refused, and a small one fits to the byte, and then the hour is full. A call of no rows
-- is still nothing then: no refusal, and nothing counted.
update private.push_log set bytes = 16777216 - 16384 where user_id = '00000000-0000-0000-0000-00000000000c';
set local role authenticated;
do $$
begin
  perform public.test_as('c');
  perform public.test_refuses(
    $q$select public.sync_push(jsonb_build_array(public.test_row('filler', 'busy', jsonb_build_object('x', repeat('y', 20000)), now())))$q$, 'sync_busy'
  );
  if public.sync_push(jsonb_build_array(public.test_row('filler', 'fits', '{}', now()))) <> 1 then
    raise exception 'a call within the hour''s bytes was not kept';
  end if;
  if public.sync_push('[]') <> 0 then
    raise exception 'a call of no rows was counted';
  end if;
end $$;
reset role;
do $$
begin
  if (select bytes from private.push_log where user_id = '00000000-0000-0000-0000-00000000000c') <> 16777216 then
    raise exception 'a small call that was kept was counted as % bytes, not 16,384',
      (select bytes from private.push_log where user_id = '00000000-0000-0000-0000-00000000000c') - (16777216 - 16384);
  end if;
end $$;

-- The hour is the same hour in every zone. A client can ask for a session's zone (PostgREST's Prefer: timezone), and in one half an
-- hour off an hour by the session's clock would be another hour, and the count would start over with each call.
set local role authenticated;
do $$
declare
  zone constant text := current_setting('timezone');
begin
  perform public.test_as('c');
  perform set_config('timezone', 'Asia/Kolkata', true);
  perform public.test_refuses($q$select public.sync_push(jsonb_build_array(public.test_row('filler', 'zone', '{}', now())))$q$, 'sync_busy');
  perform set_config('timezone', zone, true);
end $$;
reset role;

-- A new hour starts over, without being told to.
update private.push_log set hour = hour - interval '1 hour' where user_id = '00000000-0000-0000-0000-00000000000c';
set local role authenticated;
do $$
begin
  perform public.test_as('c');
  if public.sync_push(jsonb_build_array(public.test_row('filler', 'busy', jsonb_build_object('x', repeat('y', 2000)), now()))) <> 1 then
    raise exception 'the hour''s bytes did not start over';
  end if;
end $$;
reset role;
do $$
declare
  counted private.push_log;
begin
  select * into strict counted from private.push_log where user_id = '00000000-0000-0000-0000-00000000000c';
  if counted.bytes <> 16384 or counted.hour <> date_trunc('hour', now(), 'UTC') then
    raise exception 'the new hour holds %', counted;
  end if;
end $$;
delete from public.sync_rows where user_id = '00000000-0000-0000-0000-00000000000c';

-- The project as a whole (0004): past the total in private.limits, by what sync_rows takes on the disk and what the call brings,
-- every player's call is refused, with a detail that tells it from an account that is full. Real players' rows count too, so the
-- total is set from the size as it is.
select set_config('test.total', (select sync_total_bytes::text from private.limits), true);
update private.limits set sync_total_bytes = pg_total_relation_size('public.sync_rows');
set local role authenticated;
do $$
declare
  said_detail text;
begin
  perform public.test_as('c');
  begin
    perform public.sync_push(jsonb_build_array(public.test_row('filler', 'project', '{}', now())));
    raise exception 'a call past the project''s total was kept';
  exception when raise_exception then
    get stacked diagnostics said_detail = pg_exception_detail;
    if sqlerrm <> 'sync_full' or said_detail is distinct from 'project_full' then
      raise;
    end if;
  end;
end $$;
reset role;
update private.limits set sync_total_bytes = pg_total_relation_size('public.sync_rows') + 1048576;
set local role authenticated;
do $$
begin
  perform public.test_as('c');
  if public.sync_push(jsonb_build_array(public.test_row('filler', 'project', '{}', now()))) <> 1 then
    raise exception 'a call within the project''s total was not kept';
  end if;
end $$;
reset role;
update private.limits set sync_total_bytes = current_setting('test.total')::bigint;
delete from public.sync_rows where user_id = '00000000-0000-0000-0000-00000000000c';

-- The places (0005): the number of accounts with a copy is limited by private.limits' sync_seats. A place is held by an account with
-- any row. d is a made-up fourth player who holds rows, and the limit is set to the places taken as they are, real players'
-- included, so that none is free. c has no rows here, and is the stranger who asks for a place.
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'd@example.invalid');
insert into public.profiles (user_id, name, discriminator) values
  ('00000000-0000-0000-0000-00000000000d', 'Zzsyncdana', '4004');
insert into public.sync_rows (user_id, kind, row_key, data, edited_at, device_id)
select '00000000-0000-0000-0000-00000000000d', 'filler', n::text, '{"v": 1}', now() - interval '1 day', 'device-1'
from generate_series(1, 3) as n;
select set_config('test.seats', (select sync_seats::text from private.limits), true);
select set_config('test.player_rows', (select player_rows::text from private.limits), true);
select set_config('test.player_bytes', (select player_bytes::text from private.limits), true);
update private.limits set sync_seats = private.sync_places_taken();
select set_config('test.all_rows', (select count(*)::text from public.sync_rows), true);
set local role authenticated;
do $$
declare
  u record;
begin
  perform public.test_as('c');
  -- A first call is refused when the places are full, and says so with a code of its own.
  perform public.test_refuses($q$select public.sync_push(jsonb_build_array(public.test_row('filler', 'first', '{}', now())))$q$, 'sync_seats_full');
  if exists (select 1 from public.sync_rows) then
    raise exception 'a first call that was refused for the places kept a row';
  end if;
  -- A call of no rows is nothing, as it always was.
  if public.sync_push('[]') <> 0 then
    raise exception 'a call of no rows was counted when the places are full';
  end if;
  -- What the player is shown: no room, no place, and the places taken.
  select * into strict u from public.sync_usage();
  if u.rows_held <> 0 or u.bytes_held <> 0 or u.has_place or not u.seats_full
     or u.rows_limit <> current_setting('test.player_rows')::integer or u.bytes_limit <> current_setting('test.player_bytes')::bigint then
    raise exception 'a player with no rows and no place is shown %', u;
  end if;
end $$;
reset role;
do $$
begin
  if (select count(*) from public.sync_rows) <> current_setting('test.all_rows')::bigint then
    raise exception 'a first call that was refused for the places changed the rows that were held';
  end if;
end $$;

-- An account with rows keeps its place while the places are full: it pushes, new rows and edits both, and is shown that it has one.
set local role authenticated;
do $$
declare
  u record;
begin
  perform public.test_as('d');
  if public.sync_push(jsonb_build_array(public.test_row('filler', 'new', '{}', now()))) <> 1
     or public.sync_push(jsonb_build_array(public.test_row('filler', '1', '{"v": 2}', now()))) <> 1 then
    raise exception 'a player with rows was refused when the places are full';
  end if;
  select * into strict u from public.sync_usage();
  if u.rows_held <> 4 or not u.has_place or not u.seats_full then
    raise exception 'a player with rows is shown % when the places are full', u;
  end if;
end $$;

-- Deleting the account frees its place, and the next first call takes it.
do $$
begin
  perform public.delete_my_account();
end $$;
reset role;
do $$
begin
  if exists (select 1 from public.sync_rows where user_id = '00000000-0000-0000-0000-00000000000d') then
    raise exception 'delete_my_account left the rows that hold a place';
  end if;
  if private.sync_places_taken() <> (select sync_seats - 1 from private.limits) then
    raise exception 'a deleted account did not free its place: % taken of %', private.sync_places_taken(), (select sync_seats from private.limits);
  end if;
end $$;
set local role authenticated;
do $$
declare
  u record;
begin
  perform public.test_as('c');
  select * into strict u from public.sync_usage();
  if not u.has_place or u.seats_full then
    raise exception 'a player is shown % though a place is free', u;
  end if;
  if public.sync_push(jsonb_build_array(public.test_row('filler', 'first', '{}', now()))) <> 1 then
    raise exception 'a first call was refused though a place is free';
  end if;
  -- c holds the last place now, and keeps it.
  if public.sync_push(jsonb_build_array(public.test_row('filler', 'second', '{}', now()))) <> 1 then
    raise exception 'a player with rows was refused after taking the last place';
  end if;
  select * into strict u from public.sync_usage();
  if u.rows_held <> 2 or not u.has_place or not u.seats_full then
    raise exception 'a player who took the last place is shown %', u;
  end if;
end $$;
reset role;
do $$
begin
  if private.sync_places_taken() <> (select sync_seats from private.limits) then
    raise exception 'the places are not full again after c took one';
  end if;
end $$;

-- The count of bytes that sync_usage shows is the count that sync_push refuses by: the same function counts both. It is also what a
-- row has always been counted as (0004). The limit is set to what c holds and brings, less one and then exactly, and the limit of
-- rows to what c holds.
set local role authenticated;
do $$
declare
  u record;
  manual bigint;
begin
  perform public.test_as('c');
  select * into strict u from public.sync_usage();
  select sum(pg_column_size(data) + 2 * (octet_length(kind) + octet_length(row_key)) + octet_length(device_id) + 100)
  into manual from public.sync_rows;
  if u.bytes_held <> manual or u.rows_held <> (select count(*) from public.sync_rows) then
    raise exception 'sync_usage shows % rows and % bytes, and the rows take %', u.rows_held, u.bytes_held, manual;
  end if;
  perform set_config('test.held', u.bytes_held::text, true);
  perform set_config('test.brought', (
    select pg_column_size(jsonb_build_array(public.test_row('filler', 'exact', '{}', now())))
  )::text, true);
end $$;
reset role;
update private.limits set player_bytes = current_setting('test.held')::bigint + current_setting('test.brought')::bigint - 1;
set local role authenticated;
do $$
declare
  u record;
begin
  perform public.test_as('c');
  perform public.test_refuses($q$select public.sync_push(jsonb_build_array(public.test_row('filler', 'exact', '{}', now())))$q$, 'sync_full');
  select * into strict u from public.sync_usage();
  if u.bytes_limit <> current_setting('test.held')::bigint + current_setting('test.brought')::bigint - 1 then
    raise exception 'sync_usage shows the limit of bytes as %, and not the one of private.limits', u.bytes_limit;
  end if;
end $$;
reset role;
update private.limits set player_bytes = current_setting('test.held')::bigint + current_setting('test.brought')::bigint;
set local role authenticated;
do $$
begin
  perform public.test_as('c');
  if public.sync_push(jsonb_build_array(public.test_row('filler', 'exact', '{}', now()))) <> 1 then
    raise exception 'a call that fills the bytes to the last one was refused';
  end if;
end $$;
reset role;
update private.limits set player_bytes = current_setting('test.player_bytes')::bigint, player_rows = 3;
set local role authenticated;
do $$
declare
  u record;
begin
  perform public.test_as('c');
  perform public.test_refuses($q$select public.sync_push(jsonb_build_array(public.test_row('filler', 'fourth', '{}', now())))$q$, 'sync_full');
  select * into strict u from public.sync_usage();
  if u.rows_limit <> 3 or u.rows_held <> 3 then
    raise exception 'sync_usage shows % of the limit of rows that private.limits holds', u;
  end if;
end $$;
reset role;
update private.limits set
  player_rows = current_setting('test.player_rows')::integer, sync_seats = current_setting('test.seats')::integer;
delete from public.sync_rows where user_id = '00000000-0000-0000-0000-00000000000c';

-- sync_usage tells a player of themselves alone: nobody can run it without a session, and it has no argument to ask for another
-- player's. A session with no player in it is refused.
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  perform public.test_forbids($q$select * from public.sync_usage()$q$);
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
do $$
begin
  perform public.test_refuses($q$select * from public.sync_usage()$q$, 'not_signed_in');
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
  if exists (select 1 from public.sync_rows where user_id = '00000000-0000-0000-0000-00000000000a') then
    raise exception 'delete_my_account left the synced rows';
  end if;
  if not exists (select 1 from public.sync_rows where user_id = '00000000-0000-0000-0000-00000000000b') then
    raise exception 'delete_my_account took another player''s rows';
  end if;
  if exists (select 1 from private.push_log where user_id = '00000000-0000-0000-0000-00000000000a') then
    raise exception 'delete_my_account left the count of the hour';
  end if;
end $$;

-- The shape of it.
do $$
declare
  name text;
  role_name text;
begin
  if not (select relrowsecurity from pg_catalog.pg_class where oid = 'public.sync_rows'::regclass) then
    raise exception 'sync_rows has row level security off';
  end if;
  if has_table_privilege('authenticated', 'public.sync_rows', 'insert,update,delete,truncate,references,trigger') then
    raise exception 'authenticated holds more of sync_rows than reading it';
  end if;
  foreach role_name in array array['anon', 'service_role'] loop
    if has_table_privilege(role_name, 'public.sync_rows', 'select,insert,update,delete,truncate,references,trigger')
       or has_any_column_privilege(role_name, 'public.sync_rows', 'select,insert,update,references') then
      raise exception '% holds a part of sync_rows', role_name;
    end if;
  end loop;
  foreach name in array array['user_id', 'kind', 'row_key', 'data', 'deleted', 'edited_at', 'received_at', 'device_id'] loop
    if has_column_privilege('authenticated', 'public.sync_rows', name, 'insert')
       or has_column_privilege('authenticated', 'public.sync_rows', name, 'update') then
      raise exception 'authenticated can write %', name;
    end if;
    if not has_column_privilege('authenticated', 'public.sync_rows', name, 'select') then
      raise exception 'authenticated cannot read %', name;
    end if;
  end loop;
  -- Reading is column by column, so that no client selects the system columns (0004).
  if has_table_privilege('authenticated', 'public.sync_rows', 'select') then
    raise exception 'authenticated reads the whole table of sync_rows, system columns and all';
  end if;

  -- One policy, to read, and the owner's alone.
  if (
    select array_agg(cmd order by cmd) from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'sync_rows'
  ) <> array['SELECT'] then
    raise exception 'sync_rows has more than the policy to read';
  end if;
  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'sync_rows'
      and (roles <> array['authenticated']::name[] or coalesce(qual, '') !~ 'auth\.uid\(\)')
  ) then
    raise exception 'the policy of sync_rows is not the owner''s alone';
  end if;

  -- The call is the one way in, with the owner's rights. In this order (0004, with the places of 0005): a call of no rows returns at
  -- once; one larger than an account holds is refused before its rows are read; the rows are judged; the player is found and held; a
  -- call of theirs already under way refuses this one at once, as a call that waited held a connection of the project's; then the
  -- project's total, the places, the purge of old deletes, the player's own count and the hour; and nothing is written until all of
  -- them were asked: a check after the write would leave a refused call's bulk on the disk. Only two connections can show the lock,
  -- and a file here has one, so this holds the means: the lock is one that is tried, never waited for. The limits of a player are
  -- read from private.limits and written nowhere in the function.
  if not (select prosecdef from pg_catalog.pg_proc where oid = 'public.sync_push(jsonb)'::regprocedure) then
    raise exception 'sync_push is not security definer';
  end if;
  if (
    select position('jsonb_array_length(p_rows) = 0' in prosrc) between 1 and position('bytes_brought > byte_limit' in prosrc)
       and position('bytes_brought > byte_limit' in prosrc) < position('262144' in prosrc)
       and position('262144' in prosrc) < position('for key share' in prosrc)
       and position('for key share' in prosrc) < position('pg_try_advisory_xact_lock' in prosrc)
       and position('pg_try_advisory_xact_lock' in prosrc) < position('pg_total_relation_size' in prosrc)
       and position('pg_total_relation_size' in prosrc) < position('private.sync_places_taken' in prosrc)
       and position('private.sync_places_taken' in prosrc) < position('sync_seats_full' in prosrc)
       and position('sync_seats_full' in prosrc) < position('delete from public.sync_rows' in prosrc)
       and position('delete from public.sync_rows' in prosrc) < position('private.sync_held' in prosrc)
       and position('private.sync_held' in prosrc) < position('16384' in prosrc)
       and position('16384' in prosrc) < position('insert into private.push_log' in prosrc)
       and position('insert into private.push_log' in prosrc) < position('insert into public.sync_rows' in prosrc)
       and position('pg_advisory_xact_lock' in prosrc) = 0
       and position('4194304' in prosrc) = 0
       and position('20000' in prosrc) = 0
    from pg_catalog.pg_proc where oid = 'public.sync_push(jsonb)'::regprocedure
  ) is not true then
    raise exception 'sync_push does not return, refuse, judge, hold, try the lock, count, place and write, in that order';
  end if;
  if (select proconfig from pg_catalog.pg_proc where oid = 'public.sync_push(jsonb)'::regprocedure) is distinct from array['search_path=""'] then
    raise exception 'sync_push does not set an empty search_path';
  end if;
  if not has_function_privilege('authenticated', 'public.sync_push(jsonb)', 'execute') then
    raise exception 'authenticated cannot run sync_push';
  end if;
  foreach role_name in array array['anon', 'service_role', 'public'] loop
    if has_function_privilege(role_name, 'public.sync_push(jsonb)', 'execute') then
      raise exception '% can run sync_push', role_name;
    end if;
  end loop;

  -- The arrival is stamped by a trigger that nobody can run. It is in the schema that authenticated may enter.
  if (
    select tgenabled::text from pg_catalog.pg_trigger where tgrelid = 'public.sync_rows'::regclass and tgname = 'sync_rows_stamped'
  ) is distinct from 'O' then
    raise exception 'the arrival is not stamped by an enabled trigger';
  end if;
  if (select proconfig from pg_catalog.pg_proc where oid = 'private.stamp_received_at()'::regprocedure) is distinct from array['search_path=""'] then
    raise exception 'private.stamp_received_at does not set an empty search_path';
  end if;
  foreach role_name in array array['authenticated', 'anon', 'service_role', 'public'] loop
    if has_function_privilege(role_name, 'private.stamp_received_at()', 'execute') then
      raise exception '% can run private.stamp_received_at', role_name;
    end if;
  end loop;

  -- The count of the hour is the function's alone, as 0002's logs are.
  foreach role_name in array array['authenticated', 'anon', 'service_role', 'public'] loop
    if has_table_privilege(role_name, 'private.push_log', 'select,insert,update,delete,truncate,references,trigger') then
      raise exception '% holds a part of private.push_log', role_name;
    end if;
  end loop;
  if not exists (select 1 from pg_catalog.pg_index where indrelid = 'private.push_log'::regclass and indisprimary) then
    raise exception 'private.push_log has no primary key';
  end if;

  -- The project's total is the project owner's to change, in the SQL editor, and nobody else's (0004). It is one row.
  foreach role_name in array array['authenticated', 'anon', 'service_role', 'public'] loop
    if has_table_privilege(role_name, 'private.limits', 'select,insert,update,delete,truncate,references,trigger') then
      raise exception '% holds a part of private.limits', role_name;
    end if;
  end loop;
  if (select count(*) from private.limits where sync_total_bytes > 0) <> 1 then
    raise exception 'private.limits does not hold one total';
  end if;

  -- The places and the limits of a player (0005). The limits are columns of private.limits that the owner changes, with the
  -- defaults of 300 places, 20,000 rows and 4 MiB. sync_usage is the player's own and runs as the owner; the three functions it and
  -- sync_push share are nobody's to run.
  if (select array_agg(regexp_replace(column_default, '[^0-9]', '', 'g') order by column_name) from information_schema.columns
      where table_schema = 'private' and table_name = 'limits' and column_name in ('sync_seats', 'player_rows', 'player_bytes'))
     is distinct from array['4194304', '20000', '300'] then
    raise exception 'the defaults of the limits of private.limits are not 4194304 bytes, 20000 rows and 300 places';
  end if;
  if not (select prosecdef from pg_catalog.pg_proc where oid = 'public.sync_usage()'::regprocedure) then
    raise exception 'sync_usage is not security definer';
  end if;
  if (select proconfig from pg_catalog.pg_proc where oid = 'public.sync_usage()'::regprocedure) is distinct from array['search_path=""'] then
    raise exception 'sync_usage does not set an empty search_path';
  end if;
  if not has_function_privilege('authenticated', 'public.sync_usage()', 'execute') then
    raise exception 'authenticated cannot run sync_usage';
  end if;
  foreach role_name in array array['anon', 'service_role', 'public'] loop
    if has_function_privilege(role_name, 'public.sync_usage()', 'execute') then
      raise exception '% can run sync_usage', role_name;
    end if;
  end loop;
  foreach name in array array['private.sync_limits()', 'private.sync_held(uuid)', 'private.sync_places_taken()'] loop
    foreach role_name in array array['authenticated', 'anon', 'service_role', 'public'] loop
      if has_function_privilege(role_name, name, 'execute') then
        raise exception '% can run %', role_name, name;
      end if;
    end loop;
    if (select proconfig from pg_catalog.pg_proc where oid = to_regprocedure(name)) is distinct from array['search_path=""'] then
      raise exception '% does not set an empty search_path', name;
    end if;
  end loop;

  -- The log of requests had no primary key, which the project's advisor flagged.
  if not exists (select 1 from pg_catalog.pg_index where indrelid = 'private.request_log'::regclass and indisprimary) then
    raise exception 'private.request_log has no primary key';
  end if;
end $$;

do $$ begin raise exception 'ALL PASSED'; end $$;
rollback;
