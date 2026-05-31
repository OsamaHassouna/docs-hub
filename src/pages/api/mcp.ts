import type { APIRoute } from 'astro';
// @ts-expect-error  JS module sibling of the published mcp package
import { getTools, runTool, setSpec } from '../../../mcp/src/tools.mjs';
import MCP_PKG from '../../../mcp/package.json';
import PLAYBOOK_SPEC from '../../../mcp/data/playbook-spec.json';
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
const PROTOCOL_VERSION = '2024-11-05';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
      docs: 'https://docs.osamahassouna.com/email-playbook/cli/',
    }, null, 2),
    { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
  );
}

// Browser-based MCP clients send a CORS preflight before POSTing. Without
// an explicit OPTIONS handler Astro returns 404.
export const OPTIONS: APIRoute = () =>
  new Response(null, { status: 204, headers: CORS_HEADERS });

export const GET: APIRoute = () => infoResponse();

export const POST: APIRoute = async ({ request }) => {
  let body: JsonRpcRequest;
  try {
    body = (await request.json()) as JsonRpcRequest;
  } catch {
    return jsonRpcError(null, -32700, 'Parse error: body must be valid JSON.');
  }

  const { id = null, method, params } = body;

  if (typeof method !== 'string' || method.length === 0) {
    return jsonRpcError(id, -32600, 'Invalid request: method must be a non-empty string.');
  }

  switch (method) {
    case 'initialize':
      return jsonRpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { ...SERVER_INFO, spec_version: SPEC_VERSION },
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

    case 'notifications/initialized':
    case 'ping':
      return jsonRpcResult(id, {});

    default:
      return jsonRpcError(id, -32601, `Method not found: ${method}`);
  }
};
