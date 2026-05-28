import type { APIRoute } from 'astro';
// @ts-expect-error  JS module sibling of the published mcp package
import { getTools, runTool } from '../../../mcp/src/tools.mjs';

export const prerender = false;

const SERVER_INFO = { name: 'email-playbook', version: '0.1.0' };
const PROTOCOL_VERSION = '2024-11-05';

interface JsonRpcRequest {
  jsonrpc?: '2.0';
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

function jsonRpcResult(id: unknown, result: unknown): Response {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', id: id ?? null, result }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  );
}

function jsonRpcError(id: unknown, code: number, message: string, data?: unknown): Response {
  const body: Record<string, unknown> = { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
  if (data !== undefined) (body.error as Record<string, unknown>).data = data;
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function infoResponse(): Response {
  return new Response(
    JSON.stringify({
      server: SERVER_INFO,
      protocol: PROTOCOL_VERSION,
      transport: 'http-jsonrpc',
      methods: ['initialize', 'tools/list', 'tools/call'],
      docs: 'https://docs.osamahassouna.com/email-playbook/cli/',
    }, null, 2),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

export const GET: APIRoute = () => infoResponse();

export const POST: APIRoute = async ({ request }) => {
  let body: JsonRpcRequest;
  try {
    body = (await request.json()) as JsonRpcRequest;
  } catch {
    return jsonRpcError(null, -32700, 'Parse error: body must be JSON-RPC 2.0.');
  }

  const { id = null, method, params } = body;

  if (!method || typeof method !== 'string') {
    return jsonRpcError(id, -32600, 'Invalid request: missing method.');
  }

  switch (method) {
    case 'initialize':
      return jsonRpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
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
