# The SQL tests

Each file here proves what one part of the schema allows and refuses, on the real project: the same roles, the same `auth.uid()`, real row level security. A local Supabase would be about a dozen containers, so nothing runs one.

## Running one

Send the whole file at once, as `postgres`: to `execute_sql` of the Supabase tools, or in the project's SQL editor.

- **A file passes only when it ends in the error `ALL PASSED`.**
- Any other error is a failure, and its message says what failed.
- No error at all is a failure too.

Nothing stays behind. A file opens a transaction, and the error at its end throws the whole of it away, the made-up players included. So a run needs no cleaning up, and it can be repeated at any time.

## The shape of a file

```sql
begin;
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@example.invalid');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
do $$ begin
  -- assertions, each raising its own message when it fails
end $$;
reset role;
do $$ begin raise exception 'ALL PASSED'; end $$;
rollback;
```

## Writing one

- `set_config` changes who is asking, also in the middle of a file. `reset role` goes back to `postgres`, which can see everything, and `set local role anon` is a request with no session.
- A write the database should refuse goes in a block of its own, so that its error is caught and the file goes on. The `raise` after the write is the failure, and it is not caught, because it is a different error:

  ```sql
  begin
    update public.profiles set name = 'Other' where user_id = '00000000-0000-0000-0000-00000000000a';
    raise exception 'the owner updated name';
  exception when insufficient_privilege then null;
  end;
  ```

- A refusal with a code is the error `raise_exception`, as a failing `raise` is, so that block has to look at the message and raise again what it does not expect:

  ```sql
  exception when raise_exception then
    if sqlerrm <> 'invalid_name' then
      raise;
    end if;
  end;
  ```

- `send_friend_request`'s `no_such_tag` and `no_such_uid` are its answer and not errors, so that a lookup that found nobody keeps its line in `lookup_log`: `0002_friends.sql` says why. A caught error undoes only its own block here, where a real call loses everything it did, so a test of that line has to take the answer with no block around it and then look at the row.
- `update` with a `where` reads rows, so the select policy filters it too. To prove an update policy, also update with no `where`.
- The project holds real players. As `postgres` a file sees their rows too, so it counts only the rows of its own made-up players. A later migration can change what a file proves, and every file runs again after each migration.
- Made-up addresses end in `@example.invalid`, and nothing real goes in a test.
