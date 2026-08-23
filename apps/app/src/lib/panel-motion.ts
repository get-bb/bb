import { spring, type ValueAnimationTransition } from "motion";

export const PANEL_MOTION_DURATION_MS = 500;
export const PANEL_SPRING_TRANSITION = {
  type: "spring",
  duration: PANEL_MOTION_DURATION_MS / 1000,
  bounce: 0.1,
} satisfies ValueAnimationTransition<number>;

const panelSpringCss = String(
  spring({
    keyframes: [0, 1],
    duration: PANEL_MOTION_DURATION_MS,
    bounce: PANEL_SPRING_TRANSITION.bounce,
  }),
);
export const PANEL_SPRING_CSS_EASING = panelSpringCss.slice(
  panelSpringCss.indexOf(" ") + 1,
);
