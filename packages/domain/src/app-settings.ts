import { z } from "zod";

export const fontFamilyPreferenceSchema = z
  .string()
  .max(256)
  .refine((value) => !/[;{}\r\n]/u.test(value), {
    message: "Font families cannot contain semicolons, braces, or line breaks.",
  });

/**
 * App-wide server-backed preferences.
 * Client-local settings stay in the frontend localStorage helpers instead.
 */
export const appSettingsSchema = z
  .object({
    /**
     * macOS-only: keep the machine from idle sleeping while bb is running by
     * asking the local host daemon to hold a caffeinate assertion.
     */
    caffeinate: z.boolean(),
    /** Show shortcut hints after holding Command or Control. */
    showKeyboardHints: z.boolean(),
    /**
     * While a thread is running, make Enter steer the active turn and use
     * Command+Enter to queue a follow-up.
     */
    steerActiveThreadOnEnter: z.boolean(),
    /** Show raw provider events that bb does not yet understand. */
    showUnhandledProviderEvents: z.boolean(),
    /** Enable Codex's native memory recall and generation for bb threads. */
    codexMemoryEnabled: z.boolean(),
    /** Enable Claude Code's native auto-memory reads and writes for bb threads. */
    claudeCodeMemoryEnabled: z.boolean(),
    /** Prevent Codex from exposing its native multi-agent tools to bb threads. */
    codexSubagentsDisabled: z.boolean(),
    /** Prevent Claude Code from exposing its native Task tool to bb threads. */
    claudeCodeSubagentsDisabled: z.boolean(),
    /** Prevent Claude Code from exposing its native Workflow tool. */
    claudeCodeWorkflowsDisabled: z.boolean(),
    /** CSS font-family stack used for controls, navigation, and prose. */
    uiFontFamily: fontFamilyPreferenceSchema,
    /** CSS font-family stack used for files, diffs, code, and terminals. */
    bufferFontFamily: fontFamilyPreferenceSchema,
    /**
     * ISO timestamp of when first-run onboarding last finished or was
     * dismissed; null means it has never run. A timestamp rather than a boolean
     * so we also know *when*, and so "never ran" has an honest value.
     *
     * Deliberately not a proxy for "is bb set up": whether an agent is usable is
     * answered live by `provider.usage`, so dismissing onboarding never claims
     * the machine is configured. Setting this back to null re-triggers the flow.
     */
    onboardingCompletedAt: z.string().nullable(),
  })
  .strict();
export type AppSettings = z.infer<typeof appSettingsSchema>;

/**
 * Partial app settings update. Omitted fields keep their current values.
 */
export const appSettingsUpdateSchema = appSettingsSchema
  .partial()
  .refine((settings) => Object.keys(settings).length > 0, {
    message: "At least one app setting is required.",
  });
export type AppSettingsUpdate = z.infer<typeof appSettingsUpdateSchema>;

export const defaultAppSettings: AppSettings = {
  caffeinate: false,
  showKeyboardHints: true,
  steerActiveThreadOnEnter: false,
  showUnhandledProviderEvents: false,
  codexMemoryEnabled: true,
  claudeCodeMemoryEnabled: true,
  codexSubagentsDisabled: false,
  claudeCodeSubagentsDisabled: false,
  claudeCodeWorkflowsDisabled: false,
  uiFontFamily: "",
  bufferFontFamily: "",
  onboardingCompletedAt: null,
};
