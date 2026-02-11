import { useState, useEffect, useCallback } from "react";
import { Header } from "./components/Header";
import { RuneTimeline } from "./components/RuneTimeline";
import { RuneDetail } from "./components/RuneDetail";
import { IntegrityBanner } from "./components/IntegrityBanner";
import { WardFilters } from "./components/WardFilters";
import { useWebSocket } from "./hooks/useWebSocket";
import type { Rune, Filters, VerificationResult } from "./types";

export function App() {
  const [runes, setRunes] = useState<Rune[]>([]);
  const [selectedRune, setSelectedRune] = useState<Rune | null>(null);
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [filters, setFilters] = useState<Filters>({});
  const [loading, setLoading] = useState(true);

  // Fetch runes from API
  const fetchRunes = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filters.decision) params.set("decision", filters.decision);
      if (filters.tool_name) params.set("tool_name", filters.tool_name);
      if (filters.session_id) params.set("session_id", filters.session_id);
      params.set("limit", "200");

      const res = await fetch(`/api/runes?${params}`);
      const data = await res.json();
      setRunes(data);
    } catch {
      // API not available yet
    } finally {
      setLoading(false);
    }
  }, [filters]);

  // Fetch verification
  const fetchVerification = useCallback(async () => {
    try {
      const res = await fetch("/api/verify");
      const data = await res.json();
      setVerification(data);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchRunes();
    fetchVerification();
  }, [fetchRunes, fetchVerification]);

  // Live WebSocket updates
  const onNewRune = useCallback(
    (rune: Rune) => {
      setRunes((prev) => [rune, ...prev]);
    },
    []
  );

  useWebSocket("/ws", onNewRune);

  // Auto-refresh every 5s
  useEffect(() => {
    const interval = setInterval(() => {
      fetchRunes();
      fetchVerification();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchRunes, fetchVerification]);

  return (
    <div className="min-h-screen flex flex-col bg-heimdall-bg">
      <Header runeCount={runes.length} />
      <IntegrityBanner
        verification={verification}
        onVerify={fetchVerification}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Filters sidebar */}
        <aside className="w-56 border-r border-heimdall-border p-4 overflow-y-auto">
          <WardFilters filters={filters} onFiltersChange={setFilters} />
        </aside>

        {/* Timeline */}
        <main className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-center text-gray-500 py-12">
              Loading runes...
            </div>
          ) : runes.length === 0 ? (
            <div className="text-center text-gray-500 py-12">
              <p className="text-lg mb-2">No runes inscribed yet.</p>
              <p className="text-sm">
                Tool calls will appear here as they are intercepted by Heimdall.
              </p>
            </div>
          ) : (
            <RuneTimeline
              runes={runes}
              selectedRune={selectedRune}
              onSelectRune={setSelectedRune}
            />
          )}
        </main>

        {/* Detail panel */}
        {selectedRune && (
          <aside className="w-96 border-l border-heimdall-border overflow-y-auto">
            <RuneDetail
              rune={selectedRune}
              onClose={() => setSelectedRune(null)}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
