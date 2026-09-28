import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readWorkspace } from "@/server/store";
import { guardLocalRequest } from "@/server/request";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    guardLocalRequest(request);
  } catch {
    return Response.json(
      { error: "Local, same-origin access only." },
      { status: 403 },
    );
  }
  const config = readWorkspace().settings.connection;
  if (!config.endpoint)
    return Response.json(
      { error: "Save an endpoint URL first." },
      { status: 400 },
    );
  const url = new URL(config.endpoint);
  const allowed = (process.env.DEALFINDER_CONNECTION_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim());
  if (
    !allowed.includes(url.origin) ||
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    return Response.json(
      {
        error: `Add ${url.origin} to DEALFINDER_CONNECTION_ORIGINS in .env.local to enable this connection. Endpoints must use HTTP(S) without embedded credentials or fragments.`,
      },
      { status: 400 },
    );
  }
  const token = process.env.DEALFINDER_CONNECTION_TOKEN;
  if (config.auth === "bearer" && !token)
    return Response.json(
      {
        error:
          "Set DEALFINDER_CONNECTION_TOKEN in .env.local before testing bearer authentication.",
      },
      { status: 400 },
    );
  const headers: Record<string, string> =
    config.auth === "bearer" ? { Authorization: `Bearer ${token}` } : {};
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  let client: Client | undefined;
  let transport: StreamableHTTPClientTransport | undefined;
  try {
    const safeFetch: typeof fetch = (input, init) => {
      const target = new URL(
        input instanceof Request ? input.url : String(input),
      );
      if (target.origin !== url.origin)
        throw new Error("Cross-origin connection request blocked.");
      return fetch(input, {
        ...init,
        redirect: "error",
        signal: controller.signal,
      });
    };
    if (config.type === "api") {
      const response = await safeFetch(url, {
        method: "GET",
        headers: { ...headers, Accept: "application/json" },
      });
      if (!response.ok)
        throw new Error(`The API returned HTTP ${response.status}.`);
      await response.body?.cancel();
      return Response.json({
        message: `API reachable · HTTP ${response.status}`,
        tools: [],
      });
    }
    client = new Client({ name: "dealfinder", version: "0.1.0" });
    transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers },
      fetch: safeFetch,
      reconnectionOptions: {
        maxRetries: 0,
        initialReconnectionDelay: 1000,
        maxReconnectionDelay: 1000,
        reconnectionDelayGrowFactor: 1,
      },
    });
    await client.connect(transport, { timeout: 10000 });
    const capabilities = client.getServerCapabilities();
    const tools = capabilities?.tools
      ? (await client.listTools({}, { timeout: 10000 })).tools.map((t) => ({
          name: t.name,
          description: t.description?.slice(0, 200),
        }))
      : [];
    return Response.json({
      message: `Connected to ${client.getServerVersion()?.name ?? "MCP server"} · ${tools.length} tools available`,
      tools,
    });
  } catch (error) {
    const message = controller.signal.aborted
      ? "Connection timed out. Check the endpoint and authentication."
      : error instanceof Error && /^The API returned HTTP/.test(error.message)
        ? error.message
        : "Connection failed. Check the endpoint, protocol, and authentication. MCP uses Streamable HTTP.";
    return Response.json({ error: message }, { status: 502 });
  } finally {
    try {
      await transport?.terminateSession();
    } catch {
      /* Server may not support session termination. */
    }
    await client?.close().catch(() => {});
    clearTimeout(timeout);
  }
}
