import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-stone-200 bg-white p-4 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function Badge({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${className}`}
    >
      {children}
    </span>
  );
}

export function Spinner({ label = "Memuat..." }: { label?: string }) {
  return <p className="py-8 text-center text-sm text-stone-500">{label}</p>;
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
      {message}
    </p>
  );
}

export function EmptyNote({ message }: { message: string }) {
  return <p className="py-8 text-center text-sm text-stone-500">{message}</p>;
}
