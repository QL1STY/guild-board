# The online project

Guild Board's online features run on one Supabase project. This folder holds what that project is made of:

- `migrations/`: the database, in order.
- `functions/`: the Edge Function behind an invite link.
- `tests/`: proof of every policy, run on the project itself ([`tests/README.md`](tests/README.md)).

The app reaches the project only through `netpolicy.fetch_cloud`, and only after the player signs in with Discord. Row level security decides who can read what.

## What Supabase keeps of a player

Guild Board signs in through a custom provider, `custom:discord`, that asks Discord for the `identify` scope alone, so Discord gives no e-mail address. Supabase's built-in Discord provider always asks for `email` too, which is why it is not used. Supabase keeps the player's Discord ID and name in its Auth tables, `auth.users` and `auth.identities`, where the project's owner sees them in the dashboard.

Discord names a user by `id` and Supabase looks for `sub`, so the provider's userinfo address is the Edge Function in `functions/discord-userinfo/`, which answers with those two fields and keeps nothing.

## Set up a project of your own

A fork for other people needs its own project. It takes about 15 minutes in the browser.

1. **The project.** At [supabase.com/dashboard](https://supabase.com/dashboard), make a new project, in Frankfurt (`eu-central-1`), on the free plan. Its address is `https://<project-ref>.supabase.co`. Copy its publishable key, which starts `sb_publishable_`.
2. **Discord.** At [discord.com/developers/applications](https://discord.com/developers/applications), New Application. Under OAuth2, Add Redirect: `https://<project-ref>.supabase.co/auth/v1/callback`, then Save Changes. Copy the Client ID. Reset Secret, then copy the Client Secret.
3. **The function.** Under Edge Functions, deploy `functions/discord-userinfo/index.ts` as `discord-userinfo`, then turn its JWT verification off: what reaches it is Discord's token, not one of the project's.
4. **Providers.** In the project, under Authentication, Sign In / Providers, leave the built-in Discord off. Add a new provider by manual configuration: identifier `discord`, which makes it `custom:discord`; Authorization URL `https://discord.com/oauth2/authorize`; Token URL `https://discord.com/api/oauth2/token`; Userinfo URL `https://<project-ref>.supabase.co/functions/v1/discord-userinfo`; the two values from Discord; Scopes `identify`; Allow users without email on. Open Email, turn it off, Save. On the same page, keep Allow anonymous sign-ins off: `ensure_profile` refuses an anonymous session anyway, so it would only make users with no profile.
5. **Addresses.** In the project, under Authentication, URL Configuration, set Site URL to `http://127.0.0.1` and Save. Add a Redirect URL: `http://127.0.0.1:*/auth/callback/*`.
6. **The database.** Apply the files in `migrations/` in order, `0001` first, each once, as `postgres`: with the Supabase tools, or in the project's SQL editor.
7. **The invite link.** Deploy `functions/invite` with `verify_jwt` off. A link is opened by a browser, which has no session to show.
8. **The two constants.** Put the project's host in `CLOUD_HOST` in `src/guildboard/netpolicy.py`, and its publishable key in `CLOUD_KEY` in `src/guildboard/cloud/__init__.py`. They are constants and not settings, because a settings file that could redirect the session would be a hole.
9. **Pin the host.** Put the same host in `test_the_only_addresses_outside_hoyoverse_are_the_list_the_updates_the_cloud_and_the_public_pictures`, in `tests/test_handsoff.py`.

Then run every file in `tests/` on the project.

The publishable key is public by design. The secret key and the database password never go into the app, the repository, a log or a chat, and Guild Board needs neither of them.

## A project that sleeps

A free project that goes a week without use is paused, and every request then fails. Guild Board treats that as being offline: everything local keeps working, and nothing queued is lost. A day's use keeps a project awake.

To wake one, open it at [supabase.com/dashboard](https://supabase.com/dashboard) and press Restore project.

## A project that goes read-only

A free project goes read-only when its database passes 500 MB. Reads go on working and every write is refused, so Guild Board keeps what it has queued and tries again every few minutes. `sync_push` limits how many players hold a copy (300 places), what a player holds (4 MiB and 20,000 rows) and what they write in an hour (16 MiB), and takes no more rows from anyone once `sync_rows` takes 350 MB of the disk (the next two sections). A flood of requests could still get there through `shared_stats`, and rows that were overwritten keep their space in the file: autovacuum lets later writes reuse it, and only a full vacuum gives it back.

To bring the size down, run these in the project's SQL Editor, one at a time. Each `vacuum full` locks its table while it runs.

```sql
set session characteristics as transaction read write;
vacuum full public.sync_rows;
vacuum full public.shared_stats;
set default_transaction_read_only = 'off';
```

## The project's total

Once `sync_rows` takes 350 MB on the disk, its indexes and the room of dead rows included, `sync_push` refuses every player's rows with `sync_full`, so that the rest of the 500 MB stays for everything else. The refusal's detail, `project_full`, tells it from an account that holds all it can. Guild Board keeps the changes on each PC, as it does for a full account, and sends them once there is room again. Once reached, the total stays reached until a `vacuum full` (above) gives back the room of dead rows, or the total is raised.

The total is a row of `private.limits`, which only the project's owner can change. On a paid plan it can be raised in the SQL Editor:

```sql
update private.limits set sync_total_bytes = 2000000000;
```

## The places

The copy of a player's data is limited by a number of places, `sync_seats` in `private.limits`, 300 to begin with. A place is held by an account that has any row in `sync_rows`. Past the limit, the first `sync_push` of an account with no rows is refused with `sync_seats_full`, and Guild Board tells the player that all the places are taken and that their data stays on their PC. An account that holds rows always keeps its place, and deleting the account (Delete my online data) frees it. Friends and stats are not limited by the places: they are small rows that every signed-in player has.

Two first calls at the limit can both find a place free and both be let in, so the places can pass the limit by a few. That is accepted, as a lock across the project would make every first call wait for every other.

The limits are one row of `private.limits`, which only the project's owner can change, in the SQL Editor, with no migration. Guild Board reads them each time, and shows each player how much room they use in Settings (`sync_usage`).

| Column | What it limits | Starts at |
| --- | --- | --- |
| `sync_seats` | the accounts that hold a copy | 300 |
| `player_rows` | the rows one account holds | 20,000 |
| `player_bytes` | the bytes one account holds, counted as `private.sync_held` counts them | 4,194,304 (4 MiB) |
| `sync_total_bytes` | what `sync_rows` takes on the disk, all accounts together (the previous section) | 350,000,000 |

```sql
update private.limits set sync_seats = 500;
update private.limits set player_rows = 10000, player_bytes = 2097152;
```

A weekly look, read only: the places and bytes used, next to their limits, and what `sync_rows` takes on the disk.

```sql
select
  count(*) as places_used,
  (select sync_seats from private.limits) as places_limit,
  coalesce(sum(h.bytes_held), 0) as bytes_used,
  pg_total_relation_size('public.sync_rows') as sync_rows_on_disk,
  (select sync_total_bytes from private.limits) as disk_limit
from (select distinct user_id from public.sync_rows) as holders
cross join lateral private.sync_held(holders.user_id) as h;
```

## Many players

Sign-ups stay open: anyone with a Discord account can sign in to the project that Guild Board names, and the limits above carry the load. 300 players of the real player's size take about 225 MB, within the total of 350 MB; about 80 who each fill their 4 MiB reach the total first, and then sync waits for everyone (the project's total, above). Past the places, newcomers still sign in and have friends and stats, and wait for a place. A Guild Board given to many people needs the paid plan, or each group of friends running a fork on a project of its own (Set up a project of your own).
