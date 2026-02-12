import { Runechain } from "@heimdall/core";
import type { WardDecision } from "@heimdall/core";
import type { Server, ServerWebSocket } from "bun";
import { resolve } from "path";

export async function startApiServer(
  port: number,
  dbPath: string,
  authToken?: string
): Promise<Server<unknown>> {
  const runechain = new Runechain(dbPath);
  const wsClients = new Set<ServerWebSocket<unknown>>();

  // Auth token: use provided value, env var, or generate one
  const token = authToken
    ?? process.env.HEIMDALL_API_TOKEN
    ?? crypto.randomUUID();

  if (!authToken && !process.env.HEIMDALL_API_TOKEN) {
    console.log(`  API token (auto-generated): ${token}`);
    console.log(`  Set HEIMDALL_API_TOKEN env var for a persistent token.\n`);
  }

  // Resolve dashboard dist directory
  const dashboardDist = new URL(
    "../../../dashboard/dist",
    import.meta.url
  ).pathname;

  const server = Bun.serve({
    port,
    async fetch(req, server) {
      const url = new URL(req.url);

      // CORS headers — restricted to same origin in production
      const origin = req.headers.get("origin") ?? "";
      const allowedOrigin = `http://localhost:${url.port}`;

      const corsHeaders = {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      };

      if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
      }

      // Auth check for API endpoints (not static files or WebSocket)
      if (url.pathname.startsWith("/api/")) {
        const authHeader = req.headers.get("authorization");
        const queryToken = url.searchParams.get("token");
        const providedToken = authHeader?.replace("Bearer ", "") ?? queryToken;

        if (providedToken !== token) {
          return Response.json(
            { error: "Unauthorized. Provide a valid Bearer token or ?token= query parameter." },
            { status: 401, headers: corsHeaders }
          );
        }
      }

      // WebSocket upgrade
      if (url.pathname === "/ws") {
        const wsToken = url.searchParams.get("token");
        if (wsToken !== token) {
          return new Response("Unauthorized", { status: 401 });
        }
        if (server.upgrade(req)) return undefined;
        return new Response("WebSocket upgrade failed", { status: 500 });
      }

      // REST API
      if (url.pathname === "/api/runes") {
        const params = Object.fromEntries(url.searchParams);
        const runes = runechain.getRunes({
          session_id: params.session_id || undefined,
          tool_name: params.tool_name || undefined,
          decision: (params.decision as WardDecision) || undefined,
          limit: params.limit ? Math.min(parseInt(params.limit) || 100, 1000) : 100,
          offset: params.offset ? parseInt(params.offset) : 0,
        });
        return Response.json(runes, { headers: corsHeaders });
      }

      if (url.pathname.startsWith("/api/runes/")) {
        const seq = parseInt(url.pathname.split("/").pop() ?? "");
        if (isNaN(seq) || seq < 1 || seq > Number.MAX_SAFE_INTEGER) {
          return Response.json(
            { error: "Invalid sequence" },
            { status: 400, headers: corsHeaders }
          );
        }
        const rune = runechain.getRuneBySequence(seq);
        if (!rune) {
          return Response.json(
            { error: "Rune not found" },
            { status: 404, headers: corsHeaders }
          );
        }
        return Response.json(rune, { headers: corsHeaders });
      }

      if (url.pathname === "/api/verify") {
        const result = await runechain.verifyChain();
        return Response.json(result, { headers: corsHeaders });
      }

      if (url.pathname === "/api/stats") {
        const stats = runechain.getChainStats();
        return Response.json(stats, { headers: corsHeaders });
      }

      // Serve static dashboard files
      const resolvedPathname = new URL(url.pathname, "file:///").pathname;
      const filePath =
        resolvedPathname === "/"
          ? resolve(dashboardDist, "index.html")
          : resolve(dashboardDist, resolvedPathname.slice(1));

      if (!filePath.startsWith(dashboardDist)) {
        return new Response("Forbidden", { status: 403, headers: corsHeaders });
      }

      const file = Bun.file(filePath);
      if (await file.exists()) {
        return new Response(file, { headers: corsHeaders });
      }

      // SPA fallback
      const indexFile = Bun.file(`${dashboardDist}/index.html`);
      if (await indexFile.exists()) {
        return new Response(indexFile, { headers: corsHeaders });
      }

      return new Response("Not Found", {
        status: 404,
        headers: corsHeaders,
      });
    },
    websocket: {
      open(ws) {
        wsClients.add(ws);
      },
      close(ws) {
        wsClients.delete(ws);
      },
      message() {},
    },
  });

  console.log(
    `\n  Heimdall Watchtower running at http://localhost:${port}\n`
  );

  return server;
}
