import type { Rune } from "../types";

interface RuneTimelineProps {
  runes: Rune[];
  selectedRune: Rune | null;
  onSelectRune: (rune: Rune) => void;
}

const DECISION_STYLES = {
  PASS: { bg: "bg-green-500/10", border: "border-green-500/30", text: "text-green-400", badge: "bg-green-500/20 text-green-400" },
  HALT: { bg: "bg-red-500/10", border: "border-red-500/30", text: "text-red-400", badge: "bg-red-500/20 text-red-400" },
  RESHAPE: { bg: "bg-amber-500/10", border: "border-amber-500/30", text: "text-amber-400", badge: "bg-amber-500/20 text-amber-400" },
} as const;

export function RuneTimeline({
  runes,
  selectedRune,
  onSelectRune,
}: RuneTimelineProps) {
  return (
    <div className="space-y-1">
      {runes.map((rune, i) => {
        const styles = DECISION_STYLES[rune.decision] ?? DECISION_STYLES.PASS;
        const isSelected = selectedRune?.sequence === rune.sequence;
        const isNew = i === 0;

        return (
          <button
            key={rune.sequence}
            onClick={() => onSelectRune(rune)}
            className={`w-full text-left px-4 py-2.5 rounded-lg border transition-all ${
              isSelected
                ? `${styles.bg} ${styles.border} border-opacity-100`
                : `bg-heimdall-surface border-heimdall-border hover:${styles.bg} hover:${styles.border}`
            } ${isNew ? "rune-enter" : ""}`}
          >
            <div className="flex items-center gap-3">
              {/* Sequence */}
              <span className="text-gray-600 font-mono text-xs w-8">
                #{rune.sequence}
              </span>

              {/* Timestamp */}
              <span className="text-gray-500 text-xs font-mono w-20">
                {new Date(rune.timestamp).toLocaleTimeString()}
              </span>

              {/* Decision badge */}
              <span
                className={`px-2 py-0.5 rounded text-xs font-bold ${styles.badge}`}
              >
                {rune.decision}
              </span>

              {/* Tool name */}
              <span className="text-gray-200 font-mono text-sm flex-1">
                {rune.tool_name}
              </span>

              {/* Duration */}
              {rune.duration_ms !== undefined && (
                <span className="text-gray-600 text-xs font-mono">
                  {rune.duration_ms}ms
                </span>
              )}

              {/* Hash chain link */}
              <span className="text-gray-700 text-xs font-mono">
                {rune.content_hash.slice(0, 8)}
              </span>
            </div>

            {/* Rationale for HALT/RESHAPE */}
            {rune.decision !== "PASS" && (
              <div className={`mt-1 text-xs ${styles.text} pl-11`}>
                {rune.rationale}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
