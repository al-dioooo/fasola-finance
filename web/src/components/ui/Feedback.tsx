import type { ReactNode } from "react";

// Loading placeholders — always prefer these over spinners for page content.
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-cream-200 ${className}`} />;
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-card border border-cream-200 bg-cream-50 p-5 shadow-card">
      <Skeleton className="mb-3 h-4 w-1/3" />
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={`mb-2 h-3 ${index % 2 ? "w-2/3" : "w-full"}`} />
      ))}
    </div>
  );
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-16 w-full" />
      ))}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-xl border border-sambal-200 bg-sambal-50 px-3.5 py-2.5 text-sm text-sambal-800"
    >
      {message}
    </p>
  );
}

export function EmptyState({
  emoji = "🍃",
  message,
  children
}: {
  emoji?: string;
  message: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <span aria-hidden className="text-3xl">
        {emoji}
      </span>
      <p className="text-sm text-ink-500">{message}</p>
      {children}
    </div>
  );
}
