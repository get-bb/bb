import { z } from "zod";

// Adding a preference here plus its default below is the whole change: values
// persist as key/value rows, the route and SDK carry the object as a whole,
// and `bb settings general` takes its keys from this schema. Only the UI
// control that exposes it is left.
/**
 * App-wide server-backed preferences.
 * Client-local settings stay in the frontend localStorage helpers instead.
 */
export const appSettingsSchema = z
  .object({
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

export const defaultAppSettings: AppSettings = {
  showKeyboardHints: true,
  steerActiveThreadOnEnter: false,
  showUnhandledProviderEvents: false,
  codexMemoryEnabled: true,
  claudeCodeMemoryEnabled: true,
  codexSubagentsDisabled: false,
  claudeCodeSubagentsDisabled: false,
  claudeCodeWorkflowsDisabled: false,
  onboardingCompletedAt: null,
};
