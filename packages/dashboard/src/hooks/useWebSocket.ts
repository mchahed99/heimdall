import { useEffect, useRef } from "react";
import type { Rune, DriftAlert } from "../types";

export function useWebSocket(
  path: string,
  onRune: (rune: Rune) => void,
  onDrift?: (alert: DriftAlert) => void
): void {
  const wsRef = useRef<WebSocket | null>(null);
  const onRuneRef = useRef(onRune);
  onRuneRef.current = onRune;
  const onDriftRef = useRef(onDrift);
  onDriftRef.current = onDrift;

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}${path}`;

    function connect() {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "rune" && msg.data) {
            onRuneRef.current(msg.data);
          }
          if (msg.type === "drift" && msg.data) {
            onDriftRef.current?.(msg.data);
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        // Reconnect after 2s
        setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      wsRef.current?.close();
    };
  }, [path]);
}
