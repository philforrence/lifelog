// LifeLog Worker.
//   /mcp/<MCP_TOKEN>  — Claude's connector (stateless MCP over Streamable HTTP, JSON responses).
//                       The secret path is the lock; Claude stores it as the connector URL.
//   /api/*            — the dashboard's API (Google sign-in → session token).

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { handleApi, type ApiEnv } from "./api";
import { buildMcpServer } from "./mcp";

export interface Env extends ApiEnv {
  MCP_TOKEN: string;
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path.startsWith("/api/")) return handleApi(request, env, path);

    const [section, token] = path.split("/").filter(Boolean);
    if (section === "mcp" && safeEqual(token ?? "", env.MCP_TOKEN ?? "")) {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });
      }
      const server = await buildMcpServer(env);
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      return transport.handleRequest(request);
    }

    if (path === "/") return new Response("LifeLog", { headers: { "content-type": "text/plain" } });
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
