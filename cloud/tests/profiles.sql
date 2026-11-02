-- The accounts schema: profiles, their policies, their functions and the project's default grants. Run on the real
-- project in a transaction that never commits; it passes only when it ends in the error ALL PASSED (README.md here).
begin;

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@example.invalid'),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@example.invalid'),
  ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@example.invalid'),
  ('00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'd@example.invalid'),
  ('00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null);

-- A lookup is refused within a second of the last one, and now() stands still in a transaction. This is the second passing,
-- for the player asking: set_uid and rename_profile count as lookups (0004).
create function public.test_a_second_later() returns void language sql security definer set search_path = '' as $$
  delete from private.lookup_log where user_id = auth.uid()
$$;
grant execute on function public.test_a_second_later() to authenticated;

set local role authenticated;

-- Player a: a first sign-in, then more of them.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
do $$
declare
  made public.profiles;
  again public.profiles;
  changed integer;
begin
  made := public.ensure_profile('nova');
  if made.user_id <> '00000000-0000-0000-0000-00000000000a' or made.name <> 'nova'
     or made.discriminator !~ '^[0-9]{4}$' or made.discriminator = '0000' then
    raise exception 'ensure_profile did not make a profile with a four-digit number: %', made;
  end if;
  if made.find_by_uid or made.pins <> '{}' or made.sharing <> '{}' or made.uid is not null or made.ar is not null then
    raise exception 'a new profile does not start with everything off: %', made;
  end if;

  again := public.ensure_profile('nova');
  if again is distinct from made then
    raise exception 'a second ensure_profile did not give the same row';
  end if;
  again := public.ensure_profile('Somebody Else');
  if again is distinct from made then
    raise exception 'ensure_profile changed a returning player''s name';
  end if;
  again := public.ensure_profile('a.b');
  if again is distinct from made then
    raise exception 'ensure_profile refused a returning player';
  end if;

  update public.profiles
  set ar = 58, picture_url = 'https://upload-static.hoyoverse.com/a.png'
  where user_id = '00000000-0000-0000-0000-00000000000a';
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'the owner could not update ar and picture_url';
  end if;
  -- The UID and its switch change through set_uid alone (0004).
  perform public.set_uid(712345312, true);
  if (select uid from public.profiles where user_id = '00000000-0000-0000-0000-00000000000a') is distinct from 712345312::bigint
     or not (select find_by_uid from public.profiles where user_id = '00000000-0000-0000-0000-00000000000a') then
    raise exception 'set_uid did not keep the UID and the switch';
  end if;
  begin
    update public.profiles set uid = 712345313 where user_id = '00000000-0000-0000-0000-00000000000a';
    raise exception 'the owner updated uid';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set find_by_uid = false where user_id = '00000000-0000-0000-0000-00000000000a';
    raise exception 'the owner updated find_by_uid';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.profiles set name = 'Other' where user_id = '00000000-0000-0000-0000-00000000000a';
    raise exception 'the owner updated name';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set discriminator = '0001' where user_id = '00000000-0000-0000-0000-00000000000a';
    raise exception 'the owner updated discriminator';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set pins = '{primogems}' where user_id = '00000000-0000-0000-0000-00000000000a';
    raise exception 'the owner updated pins';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set sharing = '{primogems}' where user_id = '00000000-0000-0000-0000-00000000000a';
    raise exception 'the owner updated sharing';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set user_id = '00000000-0000-0000-0000-00000000000b'
    where user_id = '00000000-0000-0000-0000-00000000000a';
    raise exception 'the owner updated user_id';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.profiles (user_id, name, discriminator)
    values ('00000000-0000-0000-0000-00000000000a', 'Other', '0001');
    raise exception 'a player inserted a profile';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.profiles where user_id = '00000000-0000-0000-0000-00000000000a';
    raise exception 'a player deleted a profile';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Only an address of HoYoverse's goes in as a picture.
do $$
declare
  bad text;
  fine text;
begin
  foreach bad in array array[
    'http://upload-static.hoyoverse.com/a.png', 'https://evil.example/a.png', 'https://hoyolab.com.evil.example/a.png',
    'https://user@hoyolab.com/a.png', 'https://evil.example/https://hoyolab.com/a.png', 'https://hoyolab.com',
    'https://nothoyolab.com/a.png', 'https://hoyolab.com/' || repeat('x', 500)
  ] loop
    begin
      update public.profiles set picture_url = bad where user_id = '00000000-0000-0000-0000-00000000000a';
      raise exception 'the picture % went in', bad;
    exception when check_violation then null;
    end;
  end loop;
  foreach fine in array array[
    'https://bbs.hoyolab.com/a.png', 'https://hoyoverse.com/a.png', 'https://act-webstatic.mihoyo.com/a/b.png?x=1'
  ] loop
    update public.profiles set picture_url = fine where user_id = '00000000-0000-0000-0000-00000000000a';
  end loop;
  update public.profiles set picture_url = null where user_id = '00000000-0000-0000-0000-00000000000a';
end $$;

-- An AR is 1 to 60, as the game has it, or there is none (0004): a friend's card showed whatever the player wrote.
do $$
declare
  bad smallint;
begin
  foreach bad in array array[0, 61, -1, 32767]::smallint[] loop
    begin
      update public.profiles set ar = bad where user_id = '00000000-0000-0000-0000-00000000000a';
      raise exception 'the AR % went in', bad;
    exception when check_violation then null;
    end;
  end loop;
  update public.profiles set ar = 1 where user_id = '00000000-0000-0000-0000-00000000000a';
  update public.profiles set ar = 60 where user_id = '00000000-0000-0000-0000-00000000000a';
  update public.profiles set ar = null where user_id = '00000000-0000-0000-0000-00000000000a';
  update public.profiles set ar = 58 where user_id = '00000000-0000-0000-0000-00000000000a';
end $$;

-- Player b: a stranger to a, under the same name in another case. A session that says it is not anonymous is as one that says
-- nothing (0004).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated","is_anonymous":false}', true);
do $$
declare
  seen bigint;
  changed integer;
begin
  perform public.ensure_profile('NOVA');

  select count(*) into seen from public.profiles where user_id = '00000000-0000-0000-0000-00000000000a';
  if seen <> 0 then
    raise exception 'a stranger selected another player''s profile';
  end if;
  select count(*) into seen from public.profiles;
  if seen <> 1 then
    raise exception 'a player selected % rows, not their own alone', seen;
  end if;

  update public.profiles set ar = 1 where user_id = '00000000-0000-0000-0000-00000000000a';
  get diagnostics changed = row_count;
  if changed <> 0 then
    raise exception 'a player updated another player''s row';
  end if;
  -- With no WHERE, the select policy has nothing to read, and only the update policy keeps a's row out of it.
  update public.profiles set ar = 7;
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'an update of every row reached % rows, not the player''s own alone', changed;
  end if;

  -- a allows finding 712345312, so b can't, and is told so by its code; hidden, b can hold it all the same (0004). A refusal
  -- changes nothing.
  begin
    perform public.set_uid(712345312, true);
    raise exception 'two players can be found by one UID';
  exception when raise_exception then
    if sqlerrm <> 'uid_taken' then
      raise;
    end if;
  end;
  if (select uid from public.profiles where user_id = '00000000-0000-0000-0000-00000000000b') is not null then
    raise exception 'a refused set_uid kept its UID';
  end if;
  perform public.set_uid(712345312, false);
  if (select uid from public.profiles where user_id = '00000000-0000-0000-0000-00000000000b') is distinct from 712345312::bigint then
    raise exception 'a hidden UID that another allows finding was refused';
  end if;
end $$;

reset role;
do $$
begin
  if (select count(distinct discriminator) from public.profiles where user_id in (
    '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b'
  )) <> 2 then
    raise exception 'nova and NOVA hold the same number';
  end if;
  if (select ar from public.profiles where user_id = '00000000-0000-0000-0000-00000000000a') is distinct from 58::smallint then
    raise exception 'the owner''s update of ar was not kept';
  end if;
end $$;
set local role authenticated;

-- Player c has no profile, so ensure_profile looks at the name. Each refusal carries its code, and no row is left.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
do $$
declare
  bad text;
  made public.profiles;
begin
  -- After 0001's own, the names that look blank or like another (0004): Hangul's four fillers, which are letters that show as
  -- nothing, alone or after a name, and letters that NFKC folds into the ones they imitate, fullwidth, bold and a ligature.
  foreach bad in array array[
    'a.b', 'x', repeat('x', 21), '', ' ab', 'ab ', E'ab\n', E'a\tb', E'\U0001F600\U0001F600', 'ab#1234', 'a/b',
    E'\U00003164\U00003164', E'\U0000115F\U0000115F', E'\U00001160\U00001160', E'\U0000FFA0\U0000FFA0', E'ab\U00003164',
    E'\U0000FF21\U0000FF22', E'\U0001D400\U0001D401', E'\U0000FB01x'
  ] loop
    begin
      perform public.ensure_profile(bad);
      raise exception 'ensure_profile took the name %', bad;
    exception when raise_exception then
      if sqlerrm <> 'invalid_name' then
        raise;
      end if;
    end;
  end loop;
  begin
    perform public.ensure_profile(null);
    raise exception 'ensure_profile took a null';
  exception when raise_exception then
    if sqlerrm <> 'invalid_name' then
      raise;
    end if;
  end;
  if exists (select 1 from public.profiles) then
    raise exception 'a refused name left a profile';
  end if;

  -- The tag's rule as the plan's check found it: letters of any language, digits, spaces, _ and -, up to 20.
  made := public.ensure_profile('Żółć 漢字-_1');
  if made.name <> 'Żółć 漢字-_1' then
    raise exception 'ensure_profile did not take a name in other alphabets: %', made;
  end if;
  made := public.rename_profile(repeat('x', 20));
  if made.name <> repeat('x', 20) then
    raise exception 'rename_profile did not take 20 letters';
  end if;
  perform public.test_a_second_later();
  made := public.rename_profile('ab');
  if made.name <> 'ab' then
    raise exception 'rename_profile did not take 2 letters';
  end if;
  -- Hangul and kana themselves stay names: what 0004 refuses is the fillers and what NFKC changes.
  perform public.test_a_second_later();
  made := public.rename_profile('김민수 さくら');
  if made.name <> '김민수 さくら' then
    raise exception 'rename_profile did not take Hangul and kana: %', made;
  end if;
end $$;

-- Player e signed in anonymously, which a project allows when its anonymous sign-ins are on: no profile, so nothing of the
-- project's room, for a session that is no sign-in with Discord (0004).
select set_config(
  'request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated","is_anonymous":true}', true
);
do $$
begin
  begin
    perform public.ensure_profile('Anon');
    raise exception 'ensure_profile took an anonymous sign-in';
  exception when raise_exception then
    if sqlerrm <> 'not_signed_in' then
      raise;
    end if;
  end;
end $$;
reset role;
do $$
begin
  if exists (select 1 from public.profiles where user_id = '00000000-0000-0000-0000-00000000000e') then
    raise exception 'an anonymous sign-in left a profile';
  end if;
end $$;

-- rename_profile: player a's number stays while it is free under the new name, and only then.
reset role;
insert into public.profiles (user_id, name, discriminator)
select '00000000-0000-0000-0000-00000000000d', 'Taken', discriminator
from public.profiles
where user_id = '00000000-0000-0000-0000-00000000000a';

-- The table's own rules, whatever the functions do: past them only the owner of the table could write.
do $$
begin
  begin
    update public.profiles set name = 'TAKEN', discriminator = (
      select discriminator from public.profiles where user_id = '00000000-0000-0000-0000-00000000000d'
    ) where user_id = '00000000-0000-0000-0000-00000000000c';
    raise exception 'two players hold one tag in two cases';
  exception when unique_violation then null;
  end;
  begin
    update public.profiles set name = 'a.b' where user_id = '00000000-0000-0000-0000-00000000000c';
    raise exception 'the table took a name with a dot';
  exception when check_violation then null;
  end;
  begin
    update public.profiles set name = ' ab' where user_id = '00000000-0000-0000-0000-00000000000c';
    raise exception 'the table took a name with a space in front';
  exception when check_violation then null;
  end;
  begin
    update public.profiles set discriminator = '123' where user_id = '00000000-0000-0000-0000-00000000000c';
    raise exception 'the table took a three-digit number';
  exception when check_violation then null;
  end;
  -- An AR of 1 to 60 and a UID of nine or ten digits, however they are written (0004).
  begin
    update public.profiles set ar = 32767 where user_id = '00000000-0000-0000-0000-00000000000c';
    raise exception 'the table took the AR 32767';
  exception when check_violation then null;
  end;
  begin
    update public.profiles set uid = -1 where user_id = '00000000-0000-0000-0000-00000000000c';
    raise exception 'the table took the UID -1';
  exception when check_violation then null;
  end;
  begin
    update public.profiles set uid = 10000000000 where user_id = '00000000-0000-0000-0000-00000000000c';
    raise exception 'the table took a UID of eleven digits';
  exception when check_violation then null;
  end;
  -- 0004 puts the new rule of names on the table when every name it holds keeps it, and leaves 0001's check, with a notice, when
  -- one doesn't: then these two fail until that name is changed. These two fillers are ones that NFKC keeps, so that it is the
  -- rule of fillers that refuses them.
  begin
    update public.profiles set name = E'\U0000115F\U00001160' where user_id = '00000000-0000-0000-0000-00000000000c';
    raise exception 'the table took a blank name (if 0004 noticed a name that breaks its rule, it kept the check of 0001)';
  exception when check_violation then null;
  end;
  begin
    update public.profiles set name = E'\U0000FF21\U0000FF22' where user_id = '00000000-0000-0000-0000-00000000000c';
    raise exception 'the table took a name that NFKC changes (if 0004 noticed a name that breaks its rule, it kept the check of 0001)';
  exception when check_violation then null;
  end;
end $$;
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
do $$
declare
  before public.profiles;
  after public.profiles;
  bad text;
begin
  select * into before from public.profiles where user_id = '00000000-0000-0000-0000-00000000000a';

  perform public.test_a_second_later();
  after := public.rename_profile('Nova');  -- only the case changes: the row's own number does not count as taken
  if after.name <> 'Nova' or after.discriminator <> before.discriminator then
    raise exception 'a change of case did not keep the number: %', after;
  end if;

  -- A rename counts as a lookup (0004): a number that changed after a rename to N said that N#<the old number> existed.
  begin
    perform public.rename_profile('Nova Vale');
    raise exception 'a second rename within the second went through';
  exception when raise_exception then
    if sqlerrm <> 'lookup_limit' then
      raise;
    end if;
  end;
  perform public.test_a_second_later();
  after := public.rename_profile('Nova Vale');
  if after.name <> 'Nova Vale' or after.discriminator <> before.discriminator then
    raise exception 'a free name did not keep the number: %', after;
  end if;

  foreach bad in array array['a.b', 'x', repeat('x', 21), ' ab'] loop
    begin
      perform public.rename_profile(bad);
      raise exception 'rename_profile took the name %', bad;
    exception when raise_exception then
      if sqlerrm <> 'invalid_name' then
        raise;
      end if;
    end;
  end loop;
  begin
    perform public.rename_profile(null);
    raise exception 'rename_profile took a null';
  exception when raise_exception then
    if sqlerrm <> 'invalid_name' then
      raise;
    end if;
  end;
  after := public.ensure_profile('nova');
  if after.name <> 'Nova Vale' then
    raise exception 'a refused name changed the profile: %', after;
  end if;

  perform public.test_a_second_later();
  after := public.rename_profile('TAKEN');  -- player d holds this number under this name, in another case
  if after.name <> 'TAKEN' or after.discriminator = before.discriminator or after.discriminator !~ '^[0-9]{4}$' then
    raise exception 'a taken number was not drawn again: %', after;
  end if;

  if after.uid is distinct from 712345312::bigint or after.ar is distinct from 58::smallint or after.created_at <> before.created_at then
    raise exception 'a rename changed more than the name and number: %', after;
  end if;
end $$;

-- Without a session: the table and all three functions are refused.
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  begin
    perform 1 from public.profiles;
    raise exception 'anon read profiles';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set ar = 1;
    raise exception 'anon updated profiles';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.ensure_profile('Nova');
    raise exception 'anon ran ensure_profile';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.rename_profile('Nova');
    raise exception 'anon ran rename_profile';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.delete_my_account();
    raise exception 'anon ran delete_my_account';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- The shape of it: row level security, the definer functions, the grants, and what a later migration starts from.
do $$
declare
  name text;
  role_name text;
begin
  if not (select relrowsecurity from pg_catalog.pg_class where oid = 'public.profiles'::regclass) then
    raise exception 'profiles has row level security off';
  end if;

  foreach name in array array[
    'public.ensure_profile(text)', 'public.rename_profile(text)', 'public.delete_my_account()', 'public.set_uid(bigint,boolean)'
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

  foreach name in array array['private.valid_name(text)', 'private.free_number(text,uuid,text)', 'private.use_lookup(uuid)'] loop
    if (select proconfig from pg_catalog.pg_proc where oid = name::regprocedure) is distinct from array['search_path=""'] then
      raise exception '% does not set an empty search_path', name;
    end if;
    foreach role_name in array array['anon', 'authenticated', 'service_role', 'public'] loop
      if has_function_privilege(role_name, name, 'execute') then
        raise exception '% can run %', role_name, name;
      end if;
    end loop;
  end loop;

  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    if has_table_privilege(role_name, 'public.profiles', 'insert,delete,truncate,references,trigger') then
      raise exception '% holds more of profiles than its policies need', role_name;
    end if;
    if has_schema_privilege(role_name, 'private', 'create') then
      raise exception '% can make objects in the private schema', role_name;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.profiles', 'select,update') or has_table_privilege('service_role', 'public.profiles', 'select,update') then
    raise exception 'anon or service_role can read or update profiles';
  end if;

  -- What a player reads is column by column, so that no client selects the system columns (0004); and it is every column.
  if has_table_privilege('authenticated', 'public.profiles', 'select') then
    raise exception 'authenticated reads the whole table of profiles, system columns and all';
  end if;
  foreach name in array array[
    'user_id', 'name', 'discriminator', 'picture_url', 'ar', 'uid', 'find_by_uid', 'pins', 'sharing', 'created_at'
  ] loop
    if not has_column_privilege('authenticated', 'public.profiles', name, 'select') then
      raise exception 'authenticated cannot read %', name;
    end if;
  end loop;

  -- What a player writes of their own row by hand: the AR and the picture. The UID and its switch go through set_uid (0004).
  foreach name in array array['picture_url', 'ar'] loop
    if not has_column_privilege('authenticated', 'public.profiles', name, 'update') then
      raise exception 'authenticated cannot update %', name;
    end if;
  end loop;
  foreach name in array array['user_id', 'name', 'discriminator', 'uid', 'find_by_uid', 'pins', 'sharing', 'created_at'] loop
    if has_column_privilege('authenticated', 'public.profiles', name, 'update') then
      raise exception 'authenticated can update %', name;
    end if;
  end loop;
  -- A UID is unique among the players who allow finding it, and only there; a second index serves every other look by UID.
  if exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_uid_key') then
    raise exception 'profiles still holds every UID unique';
  end if;
  if (
    select indisunique and pg_catalog.pg_get_indexdef(indexrelid) ~ '\(uid\) WHERE find_by_uid$'
    from pg_catalog.pg_index where indexrelid = 'public.profiles_uid_findable'::regclass
  ) is not true then
    raise exception 'profiles_uid_findable is not a unique index of the UIDs that can be found';
  end if;
  if (
    select not indisunique and pg_catalog.pg_get_indexdef(indexrelid) ~ '\(uid\)$'
    from pg_catalog.pg_index where indexrelid = 'public.profiles_uid'::regclass
  ) is not true then
    raise exception 'profiles_uid is not a plain index of the UIDs';
  end if;
  -- The private schema is closed to these two. 0002 opens it to authenticated, for the helper its policy calls, so what
  -- keeps a player from the helpers above is that neither can be run.
  if has_schema_privilege('anon', 'private', 'usage') or has_schema_privilege('service_role', 'private', 'usage') then
    raise exception 'anon or service_role can reach the private schema';
  end if;

  create table public.default_grants_probe (id bigint generated always as identity primary key);
  create function public.default_grants_probe() returns integer language sql as 'select 1';
  create function private.default_grants_probe() returns integer language sql as 'select 1';
  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    if has_table_privilege(role_name, 'public.default_grants_probe', 'select,insert,update,delete,truncate,references,trigger') then
      raise exception 'a new table is open to %', role_name;
    end if;
    if has_sequence_privilege(role_name, 'public.default_grants_probe_id_seq', 'usage,select,update') then
      raise exception 'a new sequence is open to %', role_name;
    end if;
    if has_function_privilege(role_name, 'public.default_grants_probe()', 'execute') then
      raise exception 'a new function is open to %', role_name;
    end if;
  end loop;
  if has_function_privilege('public', 'public.default_grants_probe()', 'execute')
     or has_function_privilege('public', 'private.default_grants_probe()', 'execute') then
    raise exception 'a new function is open to PUBLIC';
  end if;
end $$;

-- Delete my online data: the auth user and the profile go, and nobody else's.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
do $$
begin
  perform public.delete_my_account();
end $$;
reset role;
do $$
begin
  if exists (select 1 from auth.users where id = '00000000-0000-0000-0000-00000000000d') then
    raise exception 'delete_my_account left the auth user';
  end if;
  if exists (select 1 from public.profiles where user_id = '00000000-0000-0000-0000-00000000000d') then
    raise exception 'delete_my_account left the profile';
  end if;
  if (select count(*) from auth.users where id in (
    '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c'
  )) <> 3 or (select count(*) from public.profiles where user_id in (
    '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c'
  )) <> 3 then
    raise exception 'delete_my_account removed another player';
  end if;
end $$;

do $$ begin raise exception 'ALL PASSED'; end $$;
rollback;
