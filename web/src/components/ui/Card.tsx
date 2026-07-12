import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-card border border-cream-200 bg-cream-50 p-4 shadow-card sm:p-5 ${className}`}
    >
      {children}
    </div>
  );
}

export function CardTitle({
  children,
  className = ""
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h2 className={`font-display text-lg font-semibold text-ink-900 ${className}`}>{children}</h2>
  );
}

// Page-level heading: display serif with a small pandan leaf tick.
export function PageHeader({
  title,
  subtitle,
  actions
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-semibold text-pandan-900 sm:text-3xl">
          {title}
        </h1>
        {subtitle ? <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
