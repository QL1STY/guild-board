// What Supabase's custom OAuth provider `custom:discord` reads as its userinfo address. Discord names a user by `id`, and
// Supabase looks for `sub`, so this answers Discord's user with the two fields Guild Board uses: the id and a name. Nothing else
// of Discord's answer goes on, and nothing is kept or logged. The provider asks for the `identify` scope alone, so no e-mail
// address is ever given. The caller's own Discord token decides everything: this function holds no secret and no JWT is
// asked for, as the Authorization header holds Discord's token.
Deno.serve(async (request: Request) => {
  const token = request.headers.get("authorization");
  if (token === null) return new Response(null, { status: 401 });
  const answer = await fetch("https://discord.com/api/users/@me", { headers: { authorization: token } });
  if (!answer.ok) return new Response(null, { status: answer.status });
  const user = await answer.json();
  if (typeof user?.id !== "string") return new Response(null, { status: 502 });
  return Response.json({ sub: user.id, name: user.global_name ?? user.username });
});
