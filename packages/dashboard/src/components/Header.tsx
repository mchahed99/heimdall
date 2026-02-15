import type { VerificationResult } from "../types";

interface HeaderProps {
  verification: VerificationResult | null;
  onVerify: () => void;
}

export function Header({ verification, onVerify }: HeaderProps) {
  return (
    <header className="flex items-center justify-between px-5 h-11 border-b border-rule bg-slate-1 shrink-0 z-10">
      {/* Left: Logo */}
      <div className="flex items-center gap-2.5">
        <ShieldIcon />
        <span className="text-[13px] font-semibold tracking-[0.12em] text-t1 uppercase">
          Heimdall
        </span>
        <span className="text-[10px] text-t3 tracking-wider uppercase hidden sm:inline">
          Watchtower
        </span>
      </div>

      {/* Center: Chain integrity */}
      <div className="flex items-center">
        {verification ? (
          <ChainPill verification={verification} onVerify={onVerify} />
        ) : (
          <span className="text-t3 text-[11px] font-mono">
            Verifying...
          </span>
        )}
      </div>

      {/* Right: Status */}
      <div className="flex items-center gap-4">
        {verification?.stats && (
          <span className="text-[11px] text-t3 font-mono hidden md:inline">
            {verification.stats.sessions} sessions &middot;{" "}
            {verification.stats.unique_tools} tools
          </span>
        )}
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pass opacity-60" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-pass" />
          </span>
          <span className="text-[10px] text-pass font-medium tracking-wide uppercase">
            Active
          </span>
        </div>
      </div>
    </header>
  );
}

function ShieldIcon() {
  return (
    <svg
      width="16"
      height="18"
      viewBox="0 0 76 86"
      fill="none"
      className="text-accent shrink-0"
    >
      <path
        d="M38 2L4 16V44C4 62 17 77 38 83C59 77 72 62 72 44V16L38 2Z"
        stroke="currentColor"
        strokeWidth="5"
        fill="none"
      />
      <ellipse
        cx="38"
        cy="40"
        rx="16"
        ry="10"
        stroke="currentColor"
        strokeWidth="4"
        fill="none"
      />
      <circle cx="38" cy="40" r="3" fill="currentColor" />
    </svg>
  );
}

function ChainPill({
  verification,
  onVerify,
}: {
  verification: VerificationResult;
  onVerify: () => void;
}) {
  const valid = verification.valid;

  return (
    <button
      onClick={onVerify}
      className={`flex items-center gap-2 px-3 py-1 rounded border text-[11px] font-mono transition-colors ${
        valid
          ? "border-pass/25 text-pass/90 hover:border-pass/40 hover:bg-pass/5"
          : "border-halt/25 text-halt/90 hover:border-halt/40 hover:bg-halt/5"
      }`}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        {valid ? (
          <path
            d="M2.5 6L5 8.5L9.5 3.5"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <path
            d="M3 3L9 9M9 3L3 9"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        )}
      </svg>
      <span>
        {valid
          ? `Chain intact \u00B7 ${verification.verified_runes}${verification.signatures_verified ? ` \u00B7 Signed` : ""}`
          : `Broken #${verification.broken_at_sequence}`}
      </span>
      <span className="text-t4">
        {verification.verification_hash.slice(0, 8)}
      </span>
    </button>
  );
}
