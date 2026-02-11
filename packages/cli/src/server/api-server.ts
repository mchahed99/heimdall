import { Runechain } from "@heimdall/core";
import type { WardDecision } from "@heimdall/core";
import type { Server, ServerWebSocket } from "bun";

export async function startApiServer(
  port: number,
  dbPath: string
): Promise<Server> {
  const runechain = new Runechain(dbPath);
  const wsClients = new Set<ServerWebSocket<unknown>>();

  // Resolve dashboard dist directory
  const dashboardDist = new URL(
    "../../../dashboard/dist",
    import.meta.url
  ).pathname;

  const server = Bun.serve({
    port,
    async fetch(req, server) {
      const url = new URL(req.url);

      // CORS headers for development
      const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      };

      if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
      }

      // WebSocket upgrade
      if (url.pathname === "/ws") {
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
          limit: params.limit ? parseInt(params.limit) : 100,
          offset: params.offset ? parseInt(params.offset) : 0,
        });
        return Response.json(runes, { headers: corsHeaders });
      }

      if (url.pathname.startsWith("/api/runes/")) {
        const seq = parseInt(url.pathname.split("/").pop() ?? "");
        if (isNaN(seq)) {
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
      const filePath =
        url.pathname === "/"
          ? `${dashboardDist}/index.html`
          : `${dashboardDist}${url.pathname}`;

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
