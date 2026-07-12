import { motion } from "motion/react";
import { useId } from "react";

export interface TabItem<TId extends string = string> {
  id: TId;
  label: string;
}

// Pill tabs with a spring-animated active indicator (shared layoutId).
export function Tabs<TId extends string>({
  items,
  activeId,
  onChange,
  className = ""
}: {
  items: readonly TabItem<TId>[];
  activeId: TId;
  onChange: (id: TId) => void;
  className?: string;
}) {
  const layoutGroup = useId();

  return (
    <div
      role="tablist"
      className={`flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border border-cream-300 bg-cream-50 p-1 shadow-card ${className}`}
    >
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(item.id)}
            className={`relative rounded-full px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors ${
              active ? "text-cream-50" : "text-ink-500 hover:text-pandan-800"
            }`}
          >
            {active ? (
              <motion.span
                layoutId={`tab-pill-${layoutGroup}`}
                className="absolute inset-0 rounded-full bg-pandan-700"
                transition={{ type: "spring", stiffness: 400, damping: 32 }}
              />
            ) : null}
            <span className="relative">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// Chip row for filters (e.g. order statuses): same idea, lighter look.
export function FilterChips<TId extends string>({
  items,
  activeId,
  onChange,
  className = ""
}: {
  items: readonly TabItem<TId>[];
  activeId: TId;
  onChange: (id: TId) => void;
  className?: string;
}) {
  return (
    <div className={`flex gap-1.5 overflow-x-auto pb-1 ${className}`}>
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <motion.button
            key={item.id}
            type="button"
            whileTap={{ scale: 0.95 }}
            onClick={() => onChange(item.id)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
              active
                ? "border-pandan-700 bg-pandan-700 text-cream-50 shadow-card"
                : "border-cream-300 bg-cream-50 text-ink-500 hover:border-pandan-300 hover:text-pandan-800"
            }`}
          >
            {item.label}
          </motion.button>
        );
      })}
    </div>
  );
}
