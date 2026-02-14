import type { DriftAlert, DriftChange } from "../types";

interface DriftBannerProps {
  alert: DriftAlert;
  onDismiss: () => void;
}

export function DriftBanner({ alert, onDismiss }: DriftBannerProps) {
  return (
    <div className="drift-enter border-b border-halt/30 bg-halt/5 shrink-0">
      {/* Header bar */}
      <div className="flex items-center justify-between px-5 h-10">
        <div className="flex items-center gap-2.5">
          <WarningIcon />
          <span className="text-[11px] font-semibold tracking-[0.1em] text-halt uppercase">
            Drift Detected
          </span>
          <span className="text-[10px] font-mono text-t3">
            {alert.server_id}
          </span>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-[10px] font-mono text-t4 tabular-nums">
            {new Date(alert.timestamp).toLocaleTimeString()}
          </span>
          <button
            onClick={onDismiss}
            className="text-t3 hover:text-t1 transition-colors p-1"
            aria-label="Dismiss drift alert"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M3 3L9 9M9 3L3 9"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Changes list */}
      <div className="px-5 pb-3 space-y-1">
        {alert.changes.map((change, i) => (
          <ChangeRow key={i} change={change} />
        ))}

        {/* Hash transition + action */}
        <div className="flex items-center justify-between pt-2 border-t border-rule/50">
          <div className="flex items-center gap-2 text-[10px] font-mono text-t4">
            <span>{alert.previous_hash.slice(0, 10)}</span>
            <svg width="10" height="8" viewBox="0 0 10 8" fill="none" className="text-t4">
              <path
                d="M1 4H9M9 4L6 1M9 4L6 7"
                stroke="currentColor"
                strokeWidth="1"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="text-halt/80">{alert.current_hash.slice(0, 10)}</span>
          </div>
          <span className="text-[10px] font-mono text-t3">
            {alert.action_taken}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── Change Row ── */

function ChangeRow({ change }: { change: DriftChange }) {
  return (
    <div className="flex items-center gap-2 h-6">
      <TypeIcon type={change.type} />
      <span className="text-t1 font-mono text-[11px] shrink-0">
        {change.tool_name}
      </span>
      <span className="text-t3 text-[10px] truncate flex-1">
        {change.details}
      </span>
      <SeverityBadge severity={change.severity} />
    </div>
  );
}

/* ── Type Icon ── */

function TypeIcon({ type }: { type: DriftChange["type"] }) {
  const label = type === "added" ? "+" : type === "removed" ? "\u2212" : "~";
  const color =
    type === "added"
      ? "text-pass"
      : type === "removed"
        ? "text-halt"
        : "text-reshape";

  return (
    <span
      className={`inline-flex items-center justify-center w-4 h-4 rounded text-[11px] font-mono font-bold ${color}`}
    >
      {label}
    </span>
  );
}

/* ── Severity Badge ── */

function SeverityBadge({ severity }: { severity: DriftChange["severity"] }) {
  const style =
    severity === "critical"
      ? "text-halt bg-halt/8 border-halt/15"
      : severity === "high"
        ? "text-reshape bg-reshape/8 border-reshape/15"
        : severity === "medium"
          ? "text-amber-400 bg-amber-400/8 border-amber-400/15"
          : "text-pass bg-pass/8 border-pass/15";

  return (
    <span
      className={`inline-flex items-center justify-center h-4 px-1.5 rounded border text-[8px] font-medium tracking-[0.06em] uppercase shrink-0 ${style}`}
    >
      {severity}
    </span>
  );
}

/* ── Warning Icon ── */

function WarningIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      className="text-halt shrink-0"
    >
      <path
        d="M7 1.5L13 12.5H1L7 1.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
        strokeLinejoin="round"
      />
      <path
        d="M7 6V9M7 10.5V11"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
