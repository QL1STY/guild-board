// cloud/functions/invite/index.ts, as deployed with verify_jwt off
const CODE = /^[A-Za-z0-9_-]{16,64}$/;
Deno.serve((request: Request) => {
  const code = new URL(request.url).searchParams.get("c") ?? "";
  if (!CODE.test(code)) {
    return new Response("This invite link is not valid.\n", {
      status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return new Response(null, { status: 302, headers: { Location: `guildboard://invite/${code}` } });
});
