import type { Rune, DriftAlert } from "@heimdall/core";
import type { Server } from "bun";

export class WsBridge {
  private clients: Set<unknown> = new Set();
  private server: Server<unknown> | null = null;

  start(port: number = 3001): void {
    const bridge = this;
    this.server = Bun.serve({
      port,
      fetch(req, server) {
        if (server.upgrade(req, { data: {} })) return undefined;
        return new Response("Heimdall WebSocket Bridge", { status: 200 });
      },
      websocket: {
        open(ws) {
          bridge.clients.add(ws);
        },
        close(ws) {
          bridge.clients.delete(ws);
        },
        message() {
          // No inbound messages expected
        },
      },
    });
    console.error(`[HEIMDALL] WebSocket bridge on port ${port}`);
  }

  broadcast(rune: Rune): void {
    const payload = JSON.stringify({ type: "rune", data: rune });
    for (const client of this.clients) {
      try {
        (client as { send(data: string): void }).send(payload);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  broadcastDrift(alert: DriftAlert): void {
    const payload = JSON.stringify({ type: "drift", data: alert });
    for (const client of this.clients) {
      try {
        (client as { send(data: string): void }).send(payload);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  stop(): void {
    this.server?.stop();
    this.clients.clear();
  }
}
