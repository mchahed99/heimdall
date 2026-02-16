import type { Rune } from "../types";

interface RuneDrawerProps {
  rune: Rune;
  onClose: () => void;
}

export function RuneDrawer({ rune, onClose }: RuneDrawerProps) {
  const isHalt = rune.decision === "HALT";
  const isReshape = rune.decision === "RESHAPE";

  return (
    <aside className="w-[360px] border-l border-rule bg-slate-1 overflow-y-auto drawer-enter shrink-0">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-slate-1/95 backdrop-blur-sm border-b border-rule px-4 h-10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium text-t1">
            #{rune.sequence}
          </span>
          <Tag decision={rune.decision} />
        </div>
        <button
          onClick={onClose}
          className="text-t3 hover:text-t1 transition-colors text-sm p-0.5 rounded hover:bg-slate-3/50"
          aria-label="Close"
        >
          &times;
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Rationale */}
        {rune.rationale && (
          <div
            className={`rounded border p-2.5 text-[11px] leading-relaxed ${
              isHalt
                ? "border-halt/15 bg-halt/[0.04] text-halt/75"
                : isReshape
                  ? "border-reshape/15 bg-reshape/[0.04] text-reshape/75"
                  : "border-pass/15 bg-pass/[0.04] text-pass/75"
            }`}
          >
            {rune.rationale}
          </div>
        )}

        {/* Tool call */}
        <Section label="Tool Call">
          <KV label="Tool" value={rune.tool_name} mono />
          <KV
            label="Time"
            value={new Date(rune.timestamp).toLocaleString()}
          />
          <KV label="Session" value={rune.session_id} mono truncate />
          {rune.duration_ms !== undefined && (
            <KV label="Duration" value={`${rune.duration_ms}ms`} />
          )}
        </Section>

        {/* Arguments */}
        <Section label="Arguments">
          <pre className="text-[10px] text-t2 bg-slate-0 rounded p-2.5 overflow-x-auto font-mono leading-relaxed border border-rule whitespace-pre-wrap break-all">
            {rune.arguments_summary}
          </pre>
          <Hash value={rune.arguments_hash} className="mt-1.5" />
        </Section>

        {/* Response */}
        {rune.response_summary && (
          <Section label="Response">
            <pre className="text-[10px] text-t2 bg-slate-0 rounded p-2.5 overflow-x-auto font-mono leading-relaxed border border-rule max-h-32 whitespace-pre-wrap break-all">
              {rune.response_summary}
            </pre>
          </Section>
        )}

        {/* Matched wards */}
        <Section label="Matched Wards">
          {rune.matched_wards.length === 0 ? (
            <span className="text-t3 text-[11px]">None</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {rune.matched_wards.map((id) => (
                <span
                  key={id}
                  className="px-1.5 py-0.5 rounded border border-accent/20 bg-accent/5 text-accent text-[10px] font-mono"
                >
                  {id}
                </span>
              ))}
            </div>
          )}
        </Section>

        {/* Evaluation chain */}
        {rune.ward_chain.length > 0 && (
          <Section label="Evaluation Chain">
            <div className="space-y-1">
              {rune.ward_chain.map((step, i) => (
                <div
                  key={i}
                  className={`rounded border p-2 text-[10px] ${
                    step.matched
                      ? "border-accent/15 bg-accent/[0.03]"
                      : "border-rule bg-slate-0"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-[9px] ${step.matched ? "text-accent" : "text-t4"}`}
                    >
                      {step.matched ? "\u25A0" : "\u25A1"}
                    </span>
                    <span className="font-mono text-t1 flex-1">
                      {step.ward_id}
                    </span>
                    <span
                      className={`text-[9px] font-medium uppercase tracking-wider ${
                        step.decision === "HALT"
                          ? "text-halt"
                          : step.decision === "RESHAPE"
                            ? "text-reshape"
                            : "text-pass"
                      }`}
                    >
                      {step.decision}
                    </span>
                  </div>
                  <p className="text-t3 mt-0.5 ml-4 leading-relaxed">
                    {step.reason}
                  </p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Hash chain */}
        <Section label="Hash Chain">
          <div className="space-y-1.5">
            <div>
              <span className="text-[9px] text-t3 uppercase tracking-wider block mb-0.5">
                {rune.is_genesis ? "Previous (Genesis)" : "Previous"}
              </span>
              <Hash value={rune.previous_hash} />
            </div>
            <div className="flex justify-center text-t4 text-base">
              ↓
            </div>
            <div>
              <span className="text-[9px] text-t3 uppercase tracking-wider block mb-0.5">
                Content
              </span>
              <Hash value={rune.content_hash} highlight />
            </div>
          </div>
        </Section>

        {/* Risk Assessment */}
        {rune.risk_score !== undefined && (
          <RiskAssessment
            score={rune.risk_score}
            tier={rune.risk_tier ?? "LOW"}
            factors={rune.risk_factors}
            reasoning={rune.ai_reasoning}
          />
        )}

        {/* Signature */}
        {rune.signature && (
          <Section label="Ed25519 Signature">
            <div className="rounded border border-accent/15 bg-accent/[0.03] p-2">
              <span className="text-[9px] font-mono text-accent/60 break-all leading-relaxed block">
                {rune.signature}
              </span>
            </div>
          </Section>
        )}
      </div>
    </aside>
  );
}

/* ─── Primitives ─── */

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-[9px] text-t3 uppercase tracking-[0.1em] font-medium mb-1.5">
        {label}
      </h3>
      {children}
    </div>
  );
}

function KV({
  label,
  value,
  mono,
  truncate,
}: {
  label: string;
  value: string;
  mono?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="flex items-start gap-2 mb-1">
      <span className="text-t3 text-[10px] min-w-[52px] shrink-0">
        {label}
      </span>
      <span
        className={`text-[10px] text-t1 ${mono ? "font-mono" : ""} ${
          truncate ? "truncate" : "break-all"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function Tag({ decision }: { decision: string }) {
  const style =
    decision === "HALT"
      ? "text-halt bg-halt/10 border-halt/20"
      : decision === "RESHAPE"
        ? "text-reshape bg-reshape/10 border-reshape/20"
        : "text-pass bg-pass/10 border-pass/20";

  return (
    <span
      className={`px-1.5 py-0.5 rounded border text-[9px] font-medium uppercase tracking-wider ${style}`}
    >
      {decision}
    </span>
  );
}

function RiskBadge({ tier }: { tier: string }) {
  const style =
    tier === "CRITICAL"
      ? "text-halt bg-halt/10 border-halt/20"
      : tier === "HIGH"
        ? "text-reshape bg-reshape/10 border-reshape/20"
        : tier === "MEDIUM"
          ? "text-amber-400 bg-amber-400/10 border-amber-400/20"
          : "text-pass bg-pass/10 border-pass/20";

  return (
    <span
      className={`px-1.5 py-0.5 rounded border text-[9px] font-medium uppercase tracking-wider ${style}`}
    >
      {tier}
    </span>
  );
}

function Hash({
  value,
  highlight,
  className = "",
}: {
  value: string;
  highlight?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`text-[9px] font-mono break-all leading-relaxed block ${
        highlight ? "text-accent/60" : "text-t3"
      } ${className}`}
    >
      {value}
    </span>
  );
}

/* ─── Risk Assessment ─── */

function RiskAssessment({
  score,
  tier,
  factors,
  reasoning,
}: {
  score: number;
  tier: string;
  factors?: string[];
  reasoning?: string;
}) {
  const barColor =
    tier === "CRITICAL"
      ? "bg-halt"
      : tier === "HIGH"
        ? "bg-reshape"
        : tier === "MEDIUM"
          ? "bg-amber-400"
          : "bg-pass";

  return (
    <Section label="Risk Assessment">
      {/* Score + tier */}
      <div className="flex items-center justify-between mb-1.5">
        <RiskBadge tier={tier} />
        <span className="text-[13px] font-semibold text-t1 tabular-nums">
          {score}<span className="text-t3 text-[10px] font-normal">/100</span>
        </span>
      </div>

      {/* Bar */}
      <div className="h-1 bg-slate-3/40 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${barColor}`}
          style={{ width: `${score}%` }}
        />
      </div>

      {/* Factors */}
      {factors && factors.length > 0 && (
        <div className="mt-3 space-y-0.5">
          {factors.map((factor, i) => (
            <FactorRow key={i} factor={factor} />
          ))}
        </div>
      )}

      {/* AI Analysis */}
      {reasoning && (
        <div className="mt-3">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[9px] text-t3 uppercase tracking-wider font-medium">
              Analysis
            </span>
            <span className="text-[8px] text-t4">
              Opus 4.6
            </span>
          </div>
          <p className="text-[10px] text-t2 leading-relaxed">
            {reasoning}
          </p>
        </div>
      )}
    </Section>
  );
}

function FactorRow({ factor }: { factor: string }) {
  const isHighRisk = factor.includes("high-risk") || factor.includes("HALT");
  const isCredential = factor.includes("credential") || factor.includes("destructive");

  const dotColor = isHighRisk
    ? "text-halt/60"
    : isCredential
      ? "text-reshape/60"
      : "text-t4";

  return (
    <div className="flex items-start gap-1.5">
      <span className={`text-[6px] mt-[4px] shrink-0 ${dotColor}`}>&#9679;</span>
      <span className="text-[10px] text-t3 leading-snug">{factor}</span>
    </div>
  );
}
