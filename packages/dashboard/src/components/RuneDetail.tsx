import type { Rune } from "../types";

interface RuneDetailProps {
  rune: Rune;
  onClose: () => void;
}

export function RuneDetail({ rune, onClose }: RuneDetailProps) {
  return (
    <div className="p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-gold font-bold">Rune #{rune.sequence}</h2>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-300 text-lg"
        >
          &#10005;
        </button>
      </div>

      {/* Decision */}
      <Section label="Decision">
        <DecisionBadge decision={rune.decision} />
        <p className="text-sm text-gray-300 mt-1">{rune.rationale}</p>
      </Section>

      {/* Tool Info */}
      <Section label="Tool Call">
        <Field label="Tool" value={rune.tool_name} />
        <Field
          label="Time"
          value={new Date(rune.timestamp).toLocaleString()}
        />
        <Field label="Session" value={rune.session_id} mono />
        {rune.duration_ms !== undefined && (
          <Field label="Duration" value={`${rune.duration_ms}ms`} />
        )}
      </Section>

      {/* Arguments */}
      <Section label="Arguments">
        <pre className="text-xs text-gray-400 bg-heimdall-bg rounded p-3 overflow-x-auto">
          {rune.arguments_summary}
        </pre>
        <Field label="Hash" value={rune.arguments_hash} mono small />
      </Section>

      {/* Response */}
      {rune.response_summary && (
        <Section label="Response">
          <pre className="text-xs text-gray-400 bg-heimdall-bg rounded p-3 overflow-x-auto max-h-40">
            {rune.response_summary}
          </pre>
        </Section>
      )}

      {/* Matched Wards */}
      <Section label="Matched Wards">
        {rune.matched_wards.length === 0 ? (
          <span className="text-gray-500 text-sm">No wards matched</span>
        ) : (
          <div className="space-y-1">
            {rune.matched_wards.map((id) => (
              <span
                key={id}
                className="inline-block px-2 py-0.5 rounded bg-gold/10 text-gold text-xs font-mono mr-1"
              >
                {id}
              </span>
            ))}
          </div>
        )}
      </Section>

      {/* Ward Chain (full evaluation trace) */}
      <Section label="Ward Evaluation Chain">
        <div className="space-y-1">
          {rune.ward_chain.map((step, i) => (
            <div
              key={i}
              className={`text-xs p-2 rounded ${
                step.matched
                  ? "bg-gold/5 border border-gold/20"
                  : "bg-heimdall-bg border border-heimdall-border"
              }`}
            >
              <div className="flex items-center gap-2">
                <span>{step.matched ? "\u2714" : "\u2012"}</span>
                <span className="font-mono text-gray-300">
                  {step.ward_id}
                </span>
                <span
                  className={
                    step.matched ? "text-gold" : "text-gray-600"
                  }
                >
                  {step.decision}
                </span>
              </div>
              <p className="text-gray-500 ml-5 mt-0.5">{step.reason}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Hash Chain */}
      <Section label="Hash Chain">
        <Field
          label={rune.is_genesis ? "Previous (Genesis)" : "Previous"}
          value={rune.previous_hash}
          mono
          small
        />
        <div className="text-center text-gray-600 my-1">&#x2193;</div>
        <Field label="Content Hash" value={rune.content_hash} mono small />
      </Section>
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">
        {label}
      </h3>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  small,
}: {
  label: string;
  value: string;
  mono?: boolean;
  small?: boolean;
}) {
  return (
    <div className="flex items-start gap-2 mb-1">
      <span className="text-gray-500 text-xs min-w-16">{label}:</span>
      <span
        className={`${mono ? "font-mono" : ""} ${
          small ? "text-xs text-gray-500" : "text-sm text-gray-300"
        } break-all`}
      >
        {value}
      </span>
    </div>
  );
}

function DecisionBadge({ decision }: { decision: string }) {
  const styles = {
    PASS: "bg-green-500/20 text-green-400 border-green-500/30",
    HALT: "bg-red-500/20 text-red-400 border-red-500/30",
    RESHAPE: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  }[decision] ?? "bg-gray-500/20 text-gray-400 border-gray-500/30";

  return (
    <span className={`inline-block px-3 py-1 rounded border text-sm font-bold ${styles}`}>
      {decision}
    </span>
  );
}
