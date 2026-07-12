import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

// Bottom sheet on phones, centered dialog on larger screens.
export function Modal({
  open,
  onClose,
  title,
  children
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
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
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="relative max-h-[88dvh] w-full overflow-y-auto rounded-t-3xl border border-cream-200 bg-cream-50 p-5 shadow-lift sm:max-w-lg sm:rounded-3xl"
            initial={{ opacity: 0, y: 48 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 48 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-cream-300 sm:hidden" />
            <div className="mb-4 flex items-center justify-between gap-4">
              <h2 className="font-display text-lg font-semibold text-ink-900">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full px-2 py-1 text-sm text-ink-400 hover:bg-cream-200 hover:text-ink-700"
              >
                ✕
              </button>
            </div>
            {children}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
