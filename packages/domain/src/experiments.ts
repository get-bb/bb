import { z } from "zod";

export const ELECTRON_ACCELERATOR_MAX_LENGTH = 80;

const ELECTRON_ACCELERATOR_MODIFIERS = new Set([
  "Alt",
  "Command",
  "CommandOrControl",
  "Control",
  "Ctrl",
  "Meta",
  "Option",
  "Shift",
  "Super",
]);

const ELECTRON_ACCELERATOR_KEYS = new Set([
  "Backspace",
  "Delete",
  "Down",
  "End",
  "Enter",
  "Home",
  "Insert",
  "Left",
  "PageDown",
  "PageUp",
  "Plus",
  "Right",
  "Space",
  "Tab",
  "Up",
]);

export function isValidElectronAccelerator(accelerator: string): boolean {
  if (
    accelerator.length === 0 ||
    accelerator.length > ELECTRON_ACCELERATOR_MAX_LENGTH
  ) {
    return false;
  }
  const parts = accelerator.split("+");
  if (parts.length < 2 || parts.some((part) => part.length === 0)) {
    return false;
  }
  const key = parts.at(-1);
  if (key === undefined || ELECTRON_ACCELERATOR_MODIFIERS.has(key)) {
    return false;
  }
  const modifiers = parts.slice(0, -1);
  if (!modifiers.every((modifier) => ELECTRON_ACCELERATOR_MODIFIERS.has(modifier))) {
    return false;
  }
  return (
    /^[A-Z0-9]$/.test(key) ||
    /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(key) ||
    ELECTRON_ACCELERATOR_KEYS.has(key)
  );
}

/**
 * User-opt-in experiments (the Settings → Experiments toggles). Distinct from
 * `FeatureFlags`: flags are operator-set via env at server start, experiments
 * are user-toggled at runtime and persisted server-side so server-owned
 * policy (e.g. skill injection) can honor them.
 *
 * Every experiment defaults to off — opting in is the point.
 */
export const experimentsSchema = z.object({
  /**
   * Claude Code mock CLI traffic: routes Claude Code API requests through the
   * local proxy so forwarded requests use CLI-shaped traffic.
   */
  claudeCodeMockCliTraffic: z.boolean(),
  /**
   * Popout chat: enables the desktop-only compact always-on-top chat window.
   */
  popoutChat: z.boolean(),
  /**
   * Electron accelerator used by the desktop shell to summon popout chat.
   */
  popoutChatHotkey: z
    .string()
    .min(1)
    .max(ELECTRON_ACCELERATOR_MAX_LENGTH)
    .refine(isValidElectronAccelerator),
});
export type Experiments = z.infer<typeof experimentsSchema>;

export const defaultExperiments: Experiments = {
  claudeCodeMockCliTraffic: false,
  popoutChat: false,
  popoutChatHotkey: "Alt+Space",
};
