import type { APIRoute } from 'astro';
// @ts-expect-error  JS module sibling of the published mcp package
import { getTools, runTool, setSpec, SERVER_INSTRUCTIONS } from '../../../mcp/src/tools.mjs';
import MCP_PKG from '../../../mcp/package.json';
import PLAYBOOK_SPEC from '../../../mcp/data/playbook-spec.json';
// @ts-expect-error  JS config module at repo root, no type declarations
import { product } from '../../../product.config.mjs';
import { getRedis } from '../../lib/kv';

export const prerender = false;

// ── Privacy-friendly tool-call counters (MCP-001) ───────────────────
// The only adoption signal bots can't fake. We store nothing but the tool
// name (our own enum) and per-day totals — no IP, no args, no PII. Mirrors
// the gen:* counter style in generate-email.ts (INCR + dated-key expiry).
// Fails open: a counter error must never break a tool call.
async function countToolCall(toolName: string): Promise<void> {
  try {
    const redis = getRedis();
    if (!redis) return;
    const today = new Date().toISOString().slice(0, 10);
    const dayKey = `mcp:calls:${today}`;
    const toolDayKey = `mcp:tools:${today}`;
    const [dayCount] = await Promise.all([
      redis.incr(dayKey),
      redis.incr('mcp:calls:total'),
      redis.hincrby(toolDayKey, toolName, 1),
      redis.hincrby('mcp:tools:total', toolName, 1),
    ]);
    if (dayCount === 1) {
      await Promise.all([
        redis.expire(dayKey, 60 * 60 * 24 * 32),
        redis.expire(toolDayKey, 60 * 60 * 24 * 32),
      ]);
    }
  } catch {
    // swallow — never block a tool call on counter failure
  }
}

// Prime the shared tools.mjs spec cache from the bundler-inlined JSON so
// the hosted endpoint never falls back to readFileSync (which ENOENTs on
// Vercel because the source `data/` folder isn't shipped next to chunks).
setSpec(PLAYBOOK_SPEC);

const SERVER_INFO = { name: 'email-playbook', version: MCP_PKG.version };
const SPEC_VERSION = PLAYBOOK_SPEC.version;
// Sourced from product.config.mjs so the endpoint and the README badge
// can't silently drift apart (MCP-002).
const PROTOCOL_VERSION = product.protocolVersion;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  // The MCP-* headers are sent by Streamable HTTP clients on every request
  // after initialize; a browser client's preflight fails without them here.
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID',
  'Access-Control-Max-Age': '86400',
};

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  ...CORS_HEADERS,
};

interface JsonRpcRequest {
  jsonrpc?: '2.0';
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

function jsonRpcResult(id: unknown, result: unknown): Response {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', id: id ?? null, result }),
    { status: 200, headers: JSON_HEADERS },
  );
}

function jsonRpcError(id: unknown, code: number, message: string, data?: unknown): Response {
  const body: Record<string, unknown> = { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
  if (data !== undefined) (body.error as Record<string, unknown>).data = data;
  return new Response(JSON.stringify(body), { status: 200, headers: JSON_HEADERS });
}

function infoResponse(): Response {
  return new Response(
    JSON.stringify({
      server: SERVER_INFO,
      spec_version: SPEC_VERSION,
      protocol: PROTOCOL_VERSION,
      transport: 'http-jsonrpc',
      methods: ['initialize', 'tools/list', 'tools/call'],
      docs: 'https://docs.osamahassouna.com/email-playbook/mcp/',
    }, null, 2),
    { status: 200, headers: { 'Content-Type': 'application/json', Vary: 'Accept', ...CORS_HEADERS } },
  );
}

// Browser-based MCP clients send a CORS preflight before POSTing. Without
// an explicit OPTIONS handler Astro returns 404.
export const OPTIONS: APIRoute = () =>
  new Response(null, { status: 204, headers: CORS_HEADERS });

// A GET that asks for an event stream is an MCP client trying to open the
// server-to-client channel. This endpoint is request/response only, and the
// Streamable HTTP transport requires 405 for that, not a 200 with a body.
// A plain GET (curl, a browser) still gets the discovery document.
export const GET: APIRoute = ({ request }) => {
  // Media types are case-insensitive. The response depends on Accept, so
  // both branches carry Vary to keep a shared cache from mixing them up.
  const accept = (request.headers.get('accept') ?? '').toLowerCase();
  if (accept.includes('text/event-stream')) {
    return new Response(null, {
      status: 405,
      headers: { Allow: 'POST, OPTIONS', Vary: 'Accept', 'Cache-Control': 'no-store', ...CORS_HEADERS },
    });
  }
  return infoResponse();
};

export const POST: APIRoute = async ({ request }) => {
  let body: JsonRpcRequest;
  try {
    body = (await request.json()) as JsonRpcRequest;
  } catch {
    return jsonRpcError(null, -32700, 'Parse error: body must be valid JSON.');
  }

  // Valid JSON that is not an object (`null`, a number, a string) would throw
  // on the destructure below and surface as a 500.
  if (body === null || typeof body !== 'object') {
    return jsonRpcError(null, -32600, 'Invalid request: body must be a JSON-RPC object.');
  }

  const { id = null, method, params } = body;

  if (typeof method !== 'string' || method.length === 0) {
    return jsonRpcError(id, -32600, 'Invalid request: method must be a non-empty string.');
  }

  // Notifications expect no reply. The transport requires 202 with an empty
  // body; a JSON-RPC result here makes strict clients fail the handshake.
  if (method.startsWith('notifications/')) {
    return new Response(null, { status: 202, headers: CORS_HEADERS });
  }

  switch (method) {
    case 'initialize':
      return jsonRpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { ...SERVER_INFO, spec_version: SPEC_VERSION },
        instructions: SERVER_INSTRUCTIONS,
      });

    case 'tools/list':
      return jsonRpcResult(id, { tools: getTools() });

    case 'tools/call': {
      const callParams = (params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      const { name, arguments: args } = callParams;
      if (!name || typeof name !== 'string') {
        return jsonRpcError(id, -32602, "Invalid params: 'name' is required.");
      }
      try {
        const result = await runTool(name, args ?? {});
        await countToolCall(name);
        return jsonRpcResult(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        });
      } catch (err) {
        return jsonRpcResult(id, {
          content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
          isError: true,
        });
      }
    }

    case 'ping':
      return jsonRpcResult(id, {});

    default:
      return jsonRpcError(id, -32601, `Method not found: ${method}`);
  }
};
