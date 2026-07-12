import {
  motion,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionStyle
} from "motion/react";
import { Children, createContext, useContext, useEffect, type ReactNode } from "react";

// All entrance animation here runs on Motion's JS frameloop (MotionValues
// bound to style), NOT the Web Animations API. WAAPI clocks can stall in
// throttled/embedded WebViews, which would leave opacity-0 entrances
// permanently invisible; JS-driven springs degrade gracefully instead.

const ENTRANCE_SPRING = { stiffness: 260, damping: 26 } as const;
const STAGGER_STEP_S = 0.055;

function useEntranceStyle(delaySeconds: number, disabled: boolean): MotionStyle {
  const opacity = useSpring(disabled ? 1 : 0, ENTRANCE_SPRING);
  const y = useSpring(disabled ? 0 : 14, ENTRANCE_SPRING);
  const transform = useTransform(y, (value) =>
    value === 0 ? "none" : `translateY(${value}px)`
  );

  useEffect(() => {
    if (disabled) {
      opacity.jump(1);
      y.jump(0);
      return;
    }

    const timer = setTimeout(
      () => {
        opacity.set(1);
        y.set(0);
      },
      Math.max(0, Math.round(delaySeconds * 1000))
    );

    return () => clearTimeout(timer);
  }, [delaySeconds, disabled, opacity, y]);

  return { opacity, transform };
}

// A self-animating rise-in block.
export function Rise({
  children,
  className,
  delay = 0
}: {
  children: ReactNode;
  className?: string | undefined;
  delay?: number;
}) {
  const reduceMotion = useReducedMotion() ?? false;
  const style = useEntranceStyle(delay, reduceMotion);

  return (
    <motion.div style={style} className={className}>
      {children}
    </motion.div>
  );
}

// Wraps a page's content; re-keyed by route in Layout. Individual blocks
// (Rise/StaggerList) animate themselves, so this is a passive container.
export function PageTransition({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}

const StaggerIndexContext = createContext(0);

// Entrance stagger for lists: each direct child gets an incremental delay.
export function StaggerList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      {Children.map(children, (child, index) => (
        <StaggerIndexContext.Provider value={index}>{child}</StaggerIndexContext.Provider>
      ))}
    </div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  const index = useContext(StaggerIndexContext);

  return (
    <Rise delay={Math.min(index, 10) * STAGGER_STEP_S} className={className}>
      {children}
    </Rise>
  );
}

// KPI numbers spring from 0 to the new value on the same JS frameloop.
export function AnimatedNumber({
  value,
  format
}: {
  value: number;
  format: (value: number) => string;
}) {
  const reduceMotion = useReducedMotion();
  const spring = useSpring(reduceMotion ? value : 0, { stiffness: 90, damping: 24 });
  const display = useTransform(spring, (current) => format(Math.round(current)));

  useEffect(() => {
    spring.set(value);
  }, [spring, value]);

  if (reduceMotion) {
    return <span>{format(value)}</span>;
  }

  return <motion.span>{display}</motion.span>;
}
