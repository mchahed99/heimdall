import { useEffect, useRef, useState } from "react";
import type { Filters, VerificationResult } from "../types";

interface SidebarProps {
  stats: { total: number; PASS: number; HALT: number; RESHAPE: number };
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  verification: VerificationResult | null;
}

export function Sidebar({
  stats,
  filters,
  onFiltersChange,
  verification,
}: SidebarProps) {
  return (
    <aside className="w-[232px] border-r border-rule bg-slate-1/60 flex flex-col overflow-hidden shrink-0">
      {/* Metrics */}
      <div className="px-4 pt-4 pb-3 border-b border-rule">
        <Label>Metrics</Label>
        <div className="mt-2.5 space-y-1">
          <MetricRow label="Total" value={stats.total} />
          <MetricRow label="Halted" value={stats.HALT} color="halt" alert={stats.HALT > 0} />
          <MetricRow label="Passed" value={stats.PASS} color="pass" />
          <MetricRow label="Reshaped" value={stats.RESHAPE} color="reshape" />
        </div>
      </div>

      {/* Filters */}
      <div className="px-4 pt-3 pb-3 border-b border-rule flex-1 overflow-y-auto">
        <Label>Filters</Label>

        <div className="mt-2.5 space-y-px">
          <FilterBtn
            active={!filters.decision}
            onClick={() => onFiltersChange({ ...filters, decision: undefined })}
          >
            All
          </FilterBtn>
          <FilterBtn
            active={filters.decision === "PASS"}
            color="pass"
            onClick={() =>
              onFiltersChange({
                ...filters,
                decision: filters.decision === "PASS" ? undefined : "PASS",
              })
            }
          >
            <Dot color="pass" /> Pass
          </FilterBtn>
          <FilterBtn
            active={filters.decision === "HALT"}
            color="halt"
            onClick={() =>
              onFiltersChange({
                ...filters,
                decision: filters.decision === "HALT" ? undefined : "HALT",
              })
            }
          >
            <Dot color="halt" /> Halt
          </FilterBtn>
          <FilterBtn
            active={filters.decision === "RESHAPE"}
            color="reshape"
            onClick={() =>
              onFiltersChange({
                ...filters,
                decision: filters.decision === "RESHAPE" ? undefined : "RESHAPE",
              })
            }
          >
            <Dot color="reshape" /> Reshape
          </FilterBtn>
        </div>

        <div className="mt-4">
          <label className="text-[10px] text-t3 uppercase tracking-wider block mb-1">
            Tool
          </label>
          <input
            type="text"
            placeholder="Filter..."
            value={filters.tool_name ?? ""}
            onChange={(e) =>
              onFiltersChange({
                ...filters,
                tool_name: e.target.value || undefined,
              })
            }
            className="w-full bg-slate-0 border border-rule rounded px-2 py-1 text-[11px] font-mono text-t1 placeholder-t4 focus:border-accent/40 focus:outline-none transition-colors"
          />
        </div>

        <div className="mt-2.5">
          <label className="text-[10px] text-t3 uppercase tracking-wider block mb-1">
            Session
          </label>
          <input
            type="text"
            placeholder="Filter..."
            value={filters.session_id ?? ""}
            onChange={(e) =>
              onFiltersChange({
                ...filters,
                session_id: e.target.value || undefined,
              })
            }
            className="w-full bg-slate-0 border border-rule rounded px-2 py-1 text-[11px] font-mono text-t1 placeholder-t4 focus:border-accent/40 focus:outline-none transition-colors"
          />
        </div>

        {(filters.decision || filters.tool_name || filters.session_id) && (
          <button
            onClick={() => onFiltersChange({})}
            className="mt-2.5 text-[11px] text-t3 hover:text-accent transition-colors"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Chain stats */}
      {verification?.stats && (
        <div className="px-4 pt-3 pb-4">
          <Label>Chain</Label>
          <div className="mt-2 space-y-1">
            <KV label="Sessions" value={String(verification.stats.sessions)} />
            <KV label="Tools" value={String(verification.stats.unique_tools)} />
            {verification.stats.first_rune_timestamp && (
              <KV
                label="Since"
                value={new Date(
                  verification.stats.first_rune_timestamp
                ).toLocaleDateString()}
              />
            )}
          </div>
        </div>
      )}
    </aside>
  );
}

/* ─── Primitives ─── */

function Label({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] text-t3 uppercase tracking-[0.1em] font-medium">
      {children}
    </h3>
  );
}

function MetricRow({
  label,
  value,
  color,
  alert,
}: {
  label: string;
  value: number;
  color?: "pass" | "halt" | "reshape";
  alert?: boolean;
}) {
  const display = useAnimatedNum(value);
  const [bumped, setBumped] = useState(false);
  const prev = useRef(value);

  useEffect(() => {
    if (value !== prev.current) {
      prev.current = value;
      setBumped(true);
      const t = setTimeout(() => setBumped(false), 250);
      return () => clearTimeout(t);
    }
  }, [value]);

  const numColor =
    color === "halt"
      ? "text-halt"
      : color === "pass"
        ? "text-pass"
        : color === "reshape"
          ? "text-reshape"
          : "text-t1";

  return (
    <div
      className={`flex items-center justify-between py-1 px-2 rounded transition-colors ${
        alert ? "bg-halt/[0.06]" : ""
      }`}
    >
      <span className="text-[11px] text-t2">{label}</span>
      <span
        className={`text-[13px] font-mono font-medium tabular-nums ${numColor} ${bumped ? "num-bump" : ""}`}
      >
        {display}
      </span>
    </div>
  );
}

function FilterBtn({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean;
  color?: "pass" | "halt" | "reshape";
  onClick: () => void;
  children: React.ReactNode;
}) {
  let activeStyle = "bg-accent/10 text-accent";
  if (color === "pass") activeStyle = "bg-pass/10 text-pass";
  if (color === "halt") activeStyle = "bg-halt/10 text-halt";
  if (color === "reshape") activeStyle = "bg-reshape/10 text-reshape";

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-2 py-1.5 rounded text-[11px] flex items-center gap-1.5 transition-colors ${
        active ? activeStyle : "text-t2 hover:text-t1 hover:bg-slate-3/50"
      }`}
    >
      {children}
    </button>
  );
}

function Dot({ color }: { color: "pass" | "halt" | "reshape" }) {
  const bg =
    color === "pass"
      ? "bg-pass"
      : color === "halt"
        ? "bg-halt"
        : "bg-reshape";
  return <span className={`w-1.5 h-1.5 rounded-full ${bg} shrink-0`} />;
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] text-t3">{label}</span>
      <span className="text-[11px] text-t2 font-mono">{value}</span>
    </div>
  );
}

/* ─── Hook ─── */

function useAnimatedNum(target: number, dur = 350): number {
  const [val, setVal] = useState(target);
  const prev = useRef(target);

  useEffect(() => {
    const from = prev.current;
    prev.current = target;
    if (from === target) return;

    const t0 = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const p = Math.min((now - t0) / dur, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(from + (target - from) * ease));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, dur]);

  return val;
}
