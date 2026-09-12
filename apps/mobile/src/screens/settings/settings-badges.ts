import { useTheme } from "@/theme";

const SYSTEM_BADGE_COLORS = {
  light: {
    gray: "#8e8e93",
  },
  dark: {
    gray: "#8e8e93",
  },
} as const;

export interface BadgeColors {
  blue: string;
  green: string;
  red: string;
  gray: string;
}

export function useBadgeColors(): BadgeColors {
  const { tokens, mode } = useTheme();
  return {
    blue: tokens.primary,
    green: tokens.success,
    red: tokens.destructive,
    ...SYSTEM_BADGE_COLORS[mode],
  };
}
