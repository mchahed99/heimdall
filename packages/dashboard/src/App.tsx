import { useState, useEffect, useCallback, useMemo } from "react";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { ActivityFeed } from "./components/ActivityFeed";
import { RuneDrawer } from "./components/RuneDrawer";
import { DriftBanner } from "./components/DriftBanner";
import { useWebSocket } from "./hooks/useWebSocket";
import type { Rune, Filters, VerificationResult, DriftAlert } from "./types";

function getApiToken(): string | null {
  return new URLSearchParams(window.location.search).get("token");
}

function authHeaders(): Record<string, string> {
  const token = getApiToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function App() {
  const [runes, setRunes] = useState<Rune[]>([]);
  const [selectedRune, setSelectedRune] = useState<Rune | null>(null);
  const [verification, setVerification] = useState<VerificationResult | null>(
    null
  );
  const [filters, setFilters] = useState<Filters>({});
  const [loading, setLoading] = useState(true);
  const [haltFlash, setHaltFlash] = useState(false);
  const [driftAlert, setDriftAlert] = useState<DriftAlert | null>(null);

  const stats = useMemo(() => {
    const counts = { PASS: 0, HALT: 0, RESHAPE: 0 };
    for (const r of runes) {
      if (r.decision in counts) counts[r.decision]++;
    }
    return { total: runes.length, ...counts };
  }, [runes]);

  const fetchRunes = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filters.decision) params.set("decision", filters.decision);
      if (filters.tool_name) params.set("tool_name", filters.tool_name);
      if (filters.session_id) params.set("session_id", filters.session_id);
      params.set("limit", "200");

      const res = await fetch(`/api/runes?${params}`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      setRunes(data);
    } catch {
      // API not available yet
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const fetchVerification = useCallback(async () => {
    try {
      const res = await fetch("/api/verify", { headers: authHeaders() });
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

  const onNewRune = useCallback((rune: Rune) => {
    setRunes((prev) => [rune, ...prev]);
    if (rune.decision === "HALT") {
      setHaltFlash(true);
      setTimeout(() => setHaltFlash(false), 1200);
    }
  }, []);

  const onDrift = useCallback((alert: DriftAlert) => {
    setDriftAlert(alert);
  }, []);

  const wsToken = getApiToken();
  const wsPath = wsToken ? `/ws?token=${wsToken}` : "/ws";
  useWebSocket(wsPath, onNewRune, onDrift);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchRunes();
      fetchVerification();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchRunes, fetchVerification]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedRune(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="h-screen flex flex-col ambient-bg relative">
      <div className={`halt-veil ${haltFlash ? "active" : ""}`} />

      <Header verification={verification} onVerify={fetchVerification} />

      {driftAlert && (
        <DriftBanner
          alert={driftAlert}
          onDismiss={() => setDriftAlert(null)}
        />
      )}

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          stats={stats}
          filters={filters}
          onFiltersChange={setFilters}
          verification={verification}
        />

        <main className="flex-1 overflow-hidden">
          <ActivityFeed
            runes={runes}
            loading={loading}
            selectedSequence={selectedRune?.sequence ?? null}
            onSelectRune={setSelectedRune}
          />
        </main>

        {selectedRune && (
          <RuneDrawer
            rune={selectedRune}
            onClose={() => setSelectedRune(null)}
          />
        )}
      </div>
    </div>
  );
}
