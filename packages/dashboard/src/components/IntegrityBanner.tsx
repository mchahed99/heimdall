import type { VerificationResult } from "../types";

interface IntegrityBannerProps {
  verification: VerificationResult | null;
  onVerify: () => void;
}

export function IntegrityBanner({
  verification,
  onVerify,
}: IntegrityBannerProps) {
  if (!verification) {
    return (
      <div className="bg-heimdall-surface border-b border-heimdall-border px-6 py-2 flex items-center justify-between">
        <span className="text-gray-500 text-sm">
          Verifying runechain...
        </span>
      </div>
    );
  }

  const isValid = verification.valid;

  return (
    <div
      className={`px-6 py-2 flex items-center justify-between border-b ${
        isValid
          ? "bg-green-950/30 border-green-900/50"
          : "bg-red-950/30 border-red-900/50"
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="text-lg">{isValid ? "\u2705" : "\u274C"}</span>
        <div>
          <span
            className={`text-sm font-bold ${
              isValid ? "text-green-400" : "text-red-400"
            }`}
          >
            {isValid
              ? `Runechain Intact — ${verification.verified_runes} runes verified`
              : `Runechain Broken at rune #${verification.broken_at_sequence}`}
          </span>
          {!isValid && verification.broken_reason && (
            <p className="text-red-300 text-xs mt-0.5">
              {verification.broken_reason}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-500 font-mono">
          {verification.verification_hash.slice(0, 16)}...
        </span>
        <button
          onClick={onVerify}
          className="text-xs px-3 py-1 rounded border border-heimdall-border hover:border-gold text-gray-400 hover:text-gold transition-colors"
        >
          Re-verify
        </button>
      </div>
    </div>
  );
}
