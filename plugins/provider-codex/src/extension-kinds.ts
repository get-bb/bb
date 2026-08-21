/**
 * The codex plugin's extension kinds (docs/provider-plugin-api.md §3).
 *
 * Core keeps a small semantic vocabulary; everything codex-specific the
 * timeline carries is a `"<pluginId>/<name>"` kind whose payload schema the
 * plugin declares here and the server enforces at ingest. Two codex natives
 * live here rather than in core:
 *
 * - `provider-codex/goal` (thread state): codex's long-running Goal — the
 *   objective, its status and budget. The latest snapshot wins; `null` is
 *   the cleared state (`thread/goal/cleared`). Rows persisted before this
 *   kind existed (`thread/goal/updated`, `thread/goal/cleared`) convert to
 *   it when read.
 * - `provider-codex/macos-permission` (item): the macOS permission profile a
 *   codex approval request asks for (preferences, automation, accessibility,
 *   …). bb's provider-neutral permission layer cannot grant it, so the
 *   profile rides the timeline as its own row beside the approval instead
 *   of failing the whole approval.
 *
 * The namespace is the plugin id (`provider-codex`), which is how the server
 * finds these schemas.
 */
import { z } from "zod";

export const CODEX_PLUGIN_ID = "provider-codex";

export const CODEX_GOAL_EXTENSION_KIND = `${CODEX_PLUGIN_ID}/goal` as const;
export const CODEX_MACOS_PERMISSION_EXTENSION_KIND =
  `${CODEX_PLUGIN_ID}/macos-permission` as const;

export const codexGoalStatusSchema = z.enum([
  "active",
  "paused",
  "budgetLimited",
  "complete",
]);
export type CodexGoalStatus = z.infer<typeof codexGoalStatusSchema>;

export const codexGoalSchema = z.object({
  objective: z.string(),
  status: codexGoalStatusSchema,
  tokenBudget: z.number().nullable(),
  tokensUsed: z.number(),
  timeUsedSeconds: z.number(),
});
export type CodexGoal = z.infer<typeof codexGoalSchema>;

/** The `provider-codex/goal` state payload: the goal, or `null` once cleared. */
export const codexGoalStateSchema = z.union([codexGoalSchema, z.null()]);
export type CodexGoalState = z.infer<typeof codexGoalStateSchema>;

const codexMacOsAccessSchema = z.enum(["none", "read_only", "read_write"]);

export const codexMacOsAutomationSchema = z.union([
  z.literal("none"),
  z.literal("all"),
  z.object({ kind: z.literal("bundle_ids"), bundleIds: z.array(z.string()) }),
]);

export const codexMacOsPermissionsSchema = z.object({
  preferences: codexMacOsAccessSchema,
  automations: codexMacOsAutomationSchema,
  launchServices: z.boolean(),
  accessibility: z.boolean(),
  calendar: z.boolean(),
  reminders: z.boolean(),
  contacts: codexMacOsAccessSchema,
});
export type CodexMacOsPermissions = z.infer<typeof codexMacOsPermissionsSchema>;

/** The `provider-codex/macos-permission` item payload. */
export const codexMacOsPermissionItemSchema = z.object({
  /** The codex item the approval belongs to (a command execution). */
  approvalItemId: z.string(),
  reason: z.string().nullable(),
  permissions: codexMacOsPermissionsSchema,
});
export type CodexMacOsPermissionItem = z.infer<
  typeof codexMacOsPermissionItemSchema
>;

/** What the codex provider declares (`experimental_extensionKinds`). */
export const codexExtensionKinds = {
  goal: { state: codexGoalStateSchema },
  "macos-permission": { item: codexMacOsPermissionItemSchema },
} as const;

/** One line per requested macOS capability, for the row's detail. */
export function summarizeCodexMacOsPermissions(
  permissions: CodexMacOsPermissions,
): string[] {
  const lines: string[] = [];
  if (permissions.preferences !== "none") {
    lines.push(`preferences (${permissions.preferences.replace("_", " ")})`);
  }
  if (permissions.automations === "all") {
    lines.push("automation of every app");
  } else if (permissions.automations !== "none") {
    lines.push(
      `automation of ${permissions.automations.bundleIds.join(", ") || "no apps"}`,
    );
  }
  if (permissions.launchServices) lines.push("launch services");
  if (permissions.accessibility) lines.push("accessibility");
  if (permissions.calendar) lines.push("calendar");
  if (permissions.reminders) lines.push("reminders");
  if (permissions.contacts !== "none") {
    lines.push(`contacts (${permissions.contacts.replace("_", " ")})`);
  }
  return lines;
}
