-- Guild Board online, 0001: the accounts. One profile for each signed-in player.
-- Applied once, in order, as postgres (cloud/README.md). Refusals are `raise exception '<code>' using errcode = 'P0001'`;
-- the core keeps the sentence the player reads for each code.

-- Whatever is made from here on is out of reach until a migration grants it, as Supabase's "Securing your API" gives these
-- four statements. The last has to be global: a revoke limited to one schema cannot take back Postgres's own grant to
-- PUBLIC. It covers `private` too, so a helper that a policy calls needs a grant of its own (private.is_friend in 0002).
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated, service_role;

alter default privileges for role postgres
  revoke execute on functions from public;

-- Never exposed by the Data API: what only the database's own functions use.
create schema private;

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  discriminator text not null,
  picture_url text,
  ar smallint,
  uid bigint unique,
  find_by_uid boolean not null default false,
  pins text[] not null default '{}',
  sharing text[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint profiles_name_fits check (name ~ '^[[:alnum:] _-]{2,20}$' and name = btrim(name)),
  constraint profiles_discriminator_fits check (discriminator ~ '^[0-9]{4}$'),
  constraint profiles_picture_is_hoyoverses check (
    picture_url is null
    or (char_length(picture_url) <= 500 and picture_url ~ '^https://([a-z0-9-]+\.)*(hoyolab|hoyoverse|mihoyo)\.com/')
  )
);

-- A tag finds its player in any case, so a name and number are unique in any case.
create unique index profiles_tag_unique on public.profiles (lower(name), discriminator);

alter table public.profiles enable row level security;

revoke all on table public.profiles from public, anon, authenticated, service_role;
grant select on table public.profiles to authenticated;
-- The name, the number, the pins and the sharing change only through their functions.
grant update (picture_url, ar, uid, find_by_uid) on table public.profiles to authenticated;

-- 0002 changes this policy to let friends read too, rather than adding a second one: two permissive policies for one role
-- and action run both, on every row.
create policy profiles_select on public.profiles
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy profiles_update on public.profiles
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- The check on profiles.name, asked first so that a bad name is refused with its code. A null is no name.
create function private.valid_name(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_name is not null and p_name ~ '^[[:alnum:] _-]{2,20}$' and p_name = pg_catalog.btrim(p_name)
$$;

-- A number free under this name in any case, drawn at random; p_keep when that one is free; null when none is. The row of
-- p_me does not count as taking a number, so a player who only changes the case of their name keeps theirs.
create function private.free_number(p_name text, p_me uuid, p_keep text)
returns text
language sql
volatile
set search_path = ''
as $$
  select numbers.candidate
  from (
    select pg_catalog.lpad(n::text, 4, '0') as candidate
    from pg_catalog.generate_series(1, 9999) as n
  ) as numbers
  where not exists (
    select 1
    from public.profiles as taken
    where pg_catalog.lower(taken.name) = pg_catalog.lower(p_name)
      and taken.discriminator = numbers.candidate
      and taken.user_id is distinct from p_me
  )
  order by numbers.candidate is not distinct from p_keep desc, pg_catalog.random()
  limit 1
$$;

revoke all on function private.valid_name(text) from public, anon, authenticated, service_role;
revoke all on function private.free_number(text, uuid, text) from public, anon, authenticated, service_role;

-- The player's profile: the row they have, or a new one under p_name. A sign-in calls this each time, so a returning
-- player's name is not looked at. Two players can draw one number at the same moment, and one sign-in can race another of
-- the same player's, so a unique violation means looking again. Running out of numbers for a name refuses the name.
create function public.ensure_profile(p_name text)
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

-- The player's new name. The number stays when it is free under that name, and is drawn again when it is not.
create function public.rename_profile(p_name text)
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

-- Delete my online data: the auth user, and through `on delete cascade` everything held for them.
create function public.delete_my_account()
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
  delete from auth.users where id = me;
end
$$;

revoke all on function public.ensure_profile(text) from public, anon, authenticated, service_role;
revoke all on function public.rename_profile(text) from public, anon, authenticated, service_role;
revoke all on function public.delete_my_account() from public, anon, authenticated, service_role;
grant execute on function public.ensure_profile(text) to authenticated;
grant execute on function public.rename_profile(text) to authenticated;
grant execute on function public.delete_my_account() to authenticated;
