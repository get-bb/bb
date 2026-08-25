import { useTheme } from "@/theme";

/*
 * Fills for the Settings `IconBadge`s. Blue / green / orange / red come
 * from the palette tokens so a custom palette (Nord, Dracula) keeps its
 * accent; the rest are the iOS system colors Apple's Settings uses, fixed
 * per mode because no token carries them.
 */
const SYSTEM_BADGE_COLORS = {
  light: {
    gray: "#8e8e93",
    purple: "#af52de",
    pink: "#ff2d55",
    indigo: "#5856d6",
    teal: "#30b0c7",
    discord: "#5865f2",
    github: "#24292f",
  },
  dark: {
    gray: "#8e8e93",
    purple: "#bf5af2",
    pink: "#ff375f",
    indigo: "#5e5ce6",
    teal: "#40c8e0",
    discord: "#5865f2",
    github: "#6e7681",
  },
} as const;

export interface BadgeColors {
  blue: string;
  green: string;
  orange: string;
  red: string;
  gray: string;
  purple: string;
  pink: string;
  indigo: string;
  teal: string;
  discord: string;
  github: string;
}

/** The badge fills for the current palette and mode. */
export function useBadgeColors(): BadgeColors {
  const { tokens, mode } = useTheme();
  return {
    blue: tokens.primary,
    green: tokens.success,
    orange: tokens.warning,
    red: tokens.destructive,
    ...SYSTEM_BADGE_COLORS[mode],
  };
}
