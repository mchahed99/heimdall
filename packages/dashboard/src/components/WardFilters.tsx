import type { Filters } from "../types";

interface WardFiltersProps {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
}

const DECISIONS = ["PASS", "HALT", "RESHAPE"] as const;

export function WardFilters({ filters, onFiltersChange }: WardFiltersProps) {
  return (
    <div>
      <h2 className="text-xs text-gray-500 uppercase tracking-wider mb-3">
        Filters
      </h2>

      {/* Decision filter */}
      <div className="mb-4">
        <label className="text-xs text-gray-400 block mb-2">Decision</label>
        <div className="space-y-1">
          <button
            onClick={() =>
              onFiltersChange({ ...filters, decision: undefined })
            }
            className={`w-full text-left px-2 py-1 rounded text-xs ${
              !filters.decision
                ? "bg-gold/10 text-gold"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            All
          </button>
          {DECISIONS.map((d) => (
            <button
              key={d}
              onClick={() =>
                onFiltersChange({
                  ...filters,
                  decision: filters.decision === d ? undefined : d,
                })
              }
              className={`w-full text-left px-2 py-1 rounded text-xs flex items-center gap-2 ${
                filters.decision === d
                  ? "bg-gold/10 text-gold"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              <DecisionDot decision={d} />
              {d}
            </button>
          ))}
        </div>
      </div>

      {/* Tool filter */}
      <div className="mb-4">
        <label className="text-xs text-gray-400 block mb-2">Tool</label>
        <input
          type="text"
          placeholder="Filter by tool..."
          value={filters.tool_name ?? ""}
          onChange={(e) =>
            onFiltersChange({
              ...filters,
              tool_name: e.target.value || undefined,
            })
          }
          className="w-full bg-heimdall-bg border border-heimdall-border rounded px-2 py-1 text-xs text-gray-300 placeholder-gray-600 focus:border-gold focus:outline-none"
        />
      </div>

      {/* Session filter */}
      <div className="mb-4">
        <label className="text-xs text-gray-400 block mb-2">Session</label>
        <input
          type="text"
          placeholder="Filter by session..."
          value={filters.session_id ?? ""}
          onChange={(e) =>
            onFiltersChange({
              ...filters,
              session_id: e.target.value || undefined,
            })
          }
          className="w-full bg-heimdall-bg border border-heimdall-border rounded px-2 py-1 text-xs text-gray-300 placeholder-gray-600 focus:border-gold focus:outline-none"
        />
      </div>

      {/* Clear */}
      {(filters.decision || filters.tool_name || filters.session_id) && (
        <button
          onClick={() => onFiltersChange({})}
          className="text-xs text-gray-500 hover:text-gold"
        >
          Clear all filters
        </button>
      )}
    </div>
  );
}

function DecisionDot({ decision }: { decision: string }) {
  const color = {
    PASS: "bg-green-500",
    HALT: "bg-red-500",
    RESHAPE: "bg-amber-500",
  }[decision] ?? "bg-gray-500";

  return <span className={`w-2 h-2 rounded-full ${color}`} />;
}
