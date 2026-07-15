import { AnimatePresence, motion, type PanInfo } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface DropUpOption {
  value: string;
  label: string;
  disabled?: boolean;
}

// Dismissable "drop-up": the option list slides up from the bottom of the
// screen (a bottom sheet on phones, a centered dialog on sm+), mirroring the
// Modal component. Replaces the native <select> so every picker on the owner's
// phone opens the same big-tap-target, tap-outside-to-dismiss sheet instead of
// the cramped OS dropdown.
export function DropUpSelect({
  value,
  onChange,
  options,
  disabled = false,
  placeholder = "Pilih…",
  ariaLabel,
  title,
  className = ""
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly DropUpOption[];
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  title?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sheetTitleId = useId();

  const selected = options.find((option) => option.value === value) ?? null;

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={title}
        onClick={() => setOpen(true)}
        className={`flex w-full items-center justify-between gap-2 rounded-xl border border-cream-300 bg-cream-50 px-3.5 py-2.5 text-left text-sm transition-colors hover:border-pandan-300 focus:border-pandan-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-cream-200 disabled:text-ink-400 ${className}`}
      >
        <span className={`truncate ${selected ? "text-ink-900" : "text-ink-300"}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronUpDown open={open} />
      </button>

      <DropUpSheet
        open={open}
        onClose={close}
        options={options}
        value={value}
        label={ariaLabel ?? title ?? "Pilih opsi"}
        titleId={sheetTitleId}
        onSelect={(next) => {
          close();
          if (next !== value) {
            onChange(next);
          }
        }}
      />
    </>
  );
}

function DropUpSheet({
  open,
  onClose,
  onSelect,
  options,
  value,
  label,
  titleId
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (value: string) => void;
  options: readonly DropUpOption[];
  value: string;
  label: string;
  titleId: string;
}) {
  const selectedRef = useRef<HTMLButtonElement>(null);

  // Escape-to-close + background scroll-lock while the sheet is open.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    // Land keyboard focus on the current choice.
    const raf = window.requestAnimationFrame(() => selectedRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
      window.cancelAnimationFrame(raf);
    };
  }, [open, onClose]);

  const handleDragEnd = (_event: unknown, info: PanInfo) => {
    if (info.offset.y > 80 || info.velocity.y > 600) {
      onClose();
    }
  };

  // Portal to <body> so the fixed overlay never sits inside the <Field> label
  // (whose click-forwarding would otherwise reach dead-space taps in the sheet).
  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <motion.button
            aria-label="Tutup"
            type="button"
            onClick={onClose}
            className="absolute inset-0 bg-ink-900/40 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.div
            role="listbox"
            aria-label={label}
            className="relative max-h-[80dvh] w-full overflow-hidden rounded-t-3xl border border-cream-200 bg-cream-50 pb-[max(env(safe-area-inset-bottom),0.75rem)] shadow-lift sm:max-w-sm sm:rounded-3xl"
            initial={{ opacity: 0, y: 48 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 48 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={handleDragEnd}
          >
            <div className="cursor-grab pt-3 pb-1 active:cursor-grabbing">
              <div className="mx-auto h-1 w-10 rounded-full bg-cream-300" />
            </div>
            <p
              id={titleId}
              className="px-5 pt-1 pb-2 text-xs font-semibold tracking-wide text-ink-400 uppercase"
            >
              {label}
            </p>
            <ul className="max-h-[64dvh] overflow-y-auto px-2 pb-2">
              {options.map((option) => {
                const isSelected = option.value === value;
                return (
                  <li key={option.value}>
                    <button
                      ref={isSelected ? selectedRef : undefined}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      disabled={option.disabled}
                      onClick={() => onSelect(option.value)}
                      className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:text-ink-300 ${
                        isSelected
                          ? "bg-pandan-50 font-semibold text-pandan-800"
                          : "text-ink-700 hover:bg-cream-100"
                      }`}
                    >
                      <span className="truncate">{option.label}</span>
                      {isSelected ? <CheckIcon /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}

function ChevronUpDown({ open }: { open: boolean }) {
  return (
    <motion.svg
      aria-hidden
      viewBox="0 0 20 20"
      className="size-4 shrink-0 text-ink-400"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      animate={{ rotate: open ? 180 : 0 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
    >
      <path d="M6 8l4-4 4 4M6 12l4 4 4-4" />
    </motion.svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className="size-4 shrink-0 text-pandan-600"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 10l4 4 8-8" />
    </svg>
  );
}
