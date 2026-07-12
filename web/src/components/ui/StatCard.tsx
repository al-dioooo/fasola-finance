import type { ReactNode } from "react";

import { AnimatedNumber } from "../motion/primitives";

// KPI tile: label, sprung number, optional footnote (e.g. unpriced warning).
export function StatCard({
  label,
  value,
  format,
  tone = "default",
  footnote
}: {
  label: string;
  value: number;
  format: (value: number) => string;
  tone?: "default" | "negative" | "brand";
  footnote?: ReactNode;
}) {
  const valueClasses =
    tone === "negative"
      ? "text-sambal-700"
      : tone === "brand"
        ? "text-pandan-800"
        : "text-ink-900";

  return (
    <div className="rounded-card border border-cream-200 bg-cream-50 p-4 shadow-card">
      <p className="text-xs font-semibold tracking-wide text-ink-500 uppercase">{label}</p>
      <p className={`mt-1.5 font-display text-2xl font-semibold tabular-nums sm:text-[1.7rem] ${valueClasses}`}>
        <AnimatedNumber value={value} format={format} />
      </p>
      {footnote ? <div className="mt-1 text-xs text-kunyit-700">{footnote}</div> : null}
    </div>
  );
}
