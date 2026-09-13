/** Spencare motion presets — centralized so every animation stays consistent. */

export const spring = {
  /** Quick snappy spring — for toggles, chips, small state changes. */
  snappy: { type: "spring", stiffness: 400, damping: 30 } as const,
  /** Smooth spring — for panels, sheets, larger elements. */
  smooth: { type: "spring", stiffness: 260, damping: 28 } as const,
  /** Gentle spring — for page transitions, hero elements. */
  gentle: { type: "spring", stiffness: 160, damping: 24 } as const,
} as const;

export const easing = {
  smooth: [0.4, 0, 0.2, 1] as const,
  spring: [0.34, 1.56, 0.64, 1] as const,
  out: [0, 0, 0.2, 1] as const,
  in: [0.4, 0, 1, 1] as const,
} as const;

/** Standard fade-in for page-level content. */
export const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.15, ease: easing.smooth },
} as const;

/** Fade + slide up — for cards and list items entering. */
export const fadeUp = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 4 },
  transition: { duration: 0.2, ease: easing.smooth },
} as const;

/** Scale + fade — for dialogs, popovers. */
export const scaleIn = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.96 },
  transition: { duration: 0.15, ease: easing.smooth },
} as const;

/** Slide in from the right — for sheets. */
export const slideInRight = {
  initial: { opacity: 0, x: "100%" },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: "100%" },
  transition: spring.smooth,
} as const;

/** Stagger container — wraps a list and staggers children. */
export const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0.05,
    },
  },
} as const;

/** Stagger item — to be used inside staggerContainer. */
export const staggerItem = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.18, ease: easing.smooth },
} as const;

/** Number counter — for animating metric values changing. */
export const numberTransition = { duration: 0.4, ease: easing.smooth } as const;
