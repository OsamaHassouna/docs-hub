// Per-route CSRF guard (TECH-003).
//
// Astro's global `security.checkOrigin` stays OFF in astro.config.mjs on
// purpose: it's all-or-nothing and would 403 MCP clients on /api/mcp that
// send a non-JSON content type. Instead we guard only the state-changing /
// cost-bearing routes (generate-email, feedback) here, leaving /api/mcp and
// the read-only endpoints fully open.
//
// Mirrors Astro's own check: block a browser request whose Origin host does
// not match the deployment's own host. Requests with no Origin header
// (server-to-server, curl, native MCP clients) are allowed through — they are
// not CSRF vectors.

function forbidden(): Response {
  return new Response(JSON.stringify({ error: 'Cross-origin request blocked.' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export function blockCrossOrigin(request: Request): Response | null {
  const origin = request.headers.get('origin');
  if (!origin) return null; // no Origin → not a browser CSRF vector

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return forbidden(); // malformed Origin
  }

  // The deployment's own host. Behind Vercel's proxy request.url can carry an
  // internal host, so prefer the forwarded host when present. This keeps the
  // check correct on prod, *.vercel.app previews, and localhost without a list.
  const selfHost = request.headers.get('x-forwarded-host') ?? new URL(request.url).host;

  return originHost === selfHost ? null : forbidden();
}
