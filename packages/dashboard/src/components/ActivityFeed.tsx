import type { Rune } from "../types";

interface ActivityFeedProps {
  runes: Rune[];
  loading: boolean;
  selectedSequence: number | null;
  onSelectRune: (rune: Rune) => void;
}

export function ActivityFeed({
  runes,
  loading,
  selectedSequence,
  onSelectRune,
}: ActivityFeedProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-t3 text-[12px] font-mono">
          Loading audit trail\u2026
        </span>
      </div>
    );
  }

  if (runes.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* Table header */}
      <div className="sticky top-0 z-[3] bg-slate-0/95 backdrop-blur-sm border-b border-rule">
        <div className="flex items-center gap-2 px-5 h-8 text-[9px] text-t3 uppercase tracking-[0.08em] font-medium">
          <span className="w-12">#</span>
          <span className="w-[68px]">Time</span>
          <span className="w-[72px]">Decision</span>
          <span className="flex-1">Tool</span>
          <span className="w-12 text-right">Ms</span>
          <span className="w-[72px] text-right">Hash</span>
        </div>
      </div>

      {/* Rows */}
      <div>
        {runes.map((rune, i) => (
          <Row
            key={rune.sequence}
            rune={rune}
            isNew={i === 0}
            isSelected={selectedSequence === rune.sequence}
            onClick={() => onSelectRune(rune)}
          />
        ))}
      </div>
    </div>
  );
}

/* ─── Row ─── */

function Row({
  rune,
  isNew,
  isSelected,
  onClick,
}: {
  rune: Rune;
  isNew: boolean;
  isSelected: boolean;
  onClick: () => void;
}) {
  const isHalt = rune.decision === "HALT";
  const isReshape = rune.decision === "RESHAPE";
  const showRationale = rune.decision !== "PASS" && rune.rationale;

  const accentBorder = isHalt
    ? "border-l-halt"
    : isReshape
      ? "border-l-reshape"
      : "border-l-pass";

  const animClass =
    isNew && isHalt ? "row-halt-enter" : isNew ? "row-enter" : "";

  return (
    <button
      onClick={onClick}
      className={`group w-full text-left border-l-[3px] border-b border-b-rule/50 transition-colors ${accentBorder} ${
        isSelected
          ? "bg-slate-3/60"
          : "bg-transparent hover:bg-slate-2/50"
      } ${animClass}`}
    >
      {/* Main row */}
      <div className="flex items-center gap-2 px-4 h-9">
        <span className="text-t4 font-mono text-[11px] w-12 tabular-nums">
          {rune.sequence}
        </span>

        <span className="text-t3 text-[11px] font-mono w-[68px] tabular-nums">
          {new Date(rune.timestamp).toLocaleTimeString()}
        </span>

        <StatusTag decision={rune.decision} />

        <span className="text-t1 font-mono text-[11px] flex-1 truncate">
          {rune.tool_name}
        </span>

        {rune.risk_tier && (
          <RiskDot tier={rune.risk_tier} />
        )}

        <span className="text-t4 text-[10px] font-mono w-12 text-right tabular-nums">
          {rune.duration_ms ?? "\u2014"}
        </span>

        <span className="text-t4 text-[10px] font-mono w-[72px] text-right group-hover:text-t3 transition-colors tabular-nums">
          {rune.content_hash.slice(0, 10)}
        </span>
      </div>

      {/* Rationale sub-row */}
      {showRationale && (
        <div
          className={`px-5 pb-2 text-[10px] leading-relaxed ${
            isHalt ? "text-halt/60" : "text-reshape/60"
          }`}
        >
          {rune.rationale}
        </div>
      )}
    </button>
  );
}

/* ─── Status Tag ─── */

function StatusTag({ decision }: { decision: string }) {
  const style =
    decision === "HALT"
      ? "text-halt bg-halt/8 border-halt/15"
      : decision === "RESHAPE"
        ? "text-reshape bg-reshape/8 border-reshape/15"
        : "text-pass bg-pass/8 border-pass/15";

  return (
    <span
      className={`inline-flex items-center justify-center w-[72px] h-5 rounded border text-[9px] font-medium tracking-[0.06em] uppercase ${style}`}
    >
      {decision}
    </span>
  );
}

/* ─── Risk Dot ─── */

function RiskDot({ tier }: { tier: string }) {
  const color =
    tier === "CRITICAL"
      ? "bg-halt"
      : tier === "HIGH"
        ? "bg-reshape"
        : tier === "MEDIUM"
          ? "bg-amber-400"
          : "bg-pass";

  return (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${color}`}
      title={`Risk: ${tier}`}
    />
  );
}

/* ─── Empty State ─── */

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <svg
        width="40"
        height="44"
        viewBox="0 0 40 44"
        fill="none"
        className="mb-5 text-t4"
      >
        <path
          d="M20 2L36 9V21C36 30.2 29.2 38.6 20 41C10.8 38.6 4 30.2 4 21V9L20 2Z"
          stroke="currentColor"
          strokeWidth="1.5"
          fill="none"
        />
        <path
          d="M20 14V24M20 28V29"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      <p className="text-t2 text-[13px] font-medium mb-1">
        Monitoring active
      </p>
      <p className="text-t3 text-[11px] max-w-xs leading-relaxed">
        Tool calls will appear here as they are intercepted and evaluated by
        Heimdall.
      </p>
    </div>
  );
}
