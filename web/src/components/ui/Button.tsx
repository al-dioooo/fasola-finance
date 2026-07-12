import { motion, type HTMLMotionProps } from "motion/react";
import type { ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "dangerOutline";
type ButtonSize = "sm" | "md";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-pandan-700 text-cream-50 shadow-card hover:bg-pandan-600 disabled:bg-pandan-300",
  secondary:
    "border border-cream-300 bg-cream-50 text-ink-900 shadow-card hover:border-pandan-300 hover:bg-pandan-50 disabled:text-ink-300",
  ghost: "text-pandan-700 hover:bg-pandan-50 disabled:text-ink-300",
  danger: "bg-sambal-600 text-cream-50 shadow-card hover:bg-sambal-500 disabled:bg-sambal-200",
  dangerOutline:
    "border border-sambal-200 bg-cream-50 text-sambal-700 hover:border-sambal-400 hover:bg-sambal-50 disabled:text-ink-300"
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2.5 text-sm"
};

export interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className = "",
  type = "button",
  onClick,
  ...rest
}: ButtonProps) {
  const interactive = !disabled && !loading;

  return (
    <motion.button
      type={type}
      {...(interactive ? { whileTap: { scale: 0.97 } } : {})}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      disabled={disabled || loading}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden
          className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : null}
      {children}
    </motion.button>
  );
}
