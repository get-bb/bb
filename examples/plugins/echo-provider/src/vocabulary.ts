/**
 * The echo provider's own vocabulary: the plugin id (the namespace of its
 * extension kinds), its extension kinds with their payload schemas, the bb
 * tool it ships, and the presentation of every row its bridge opens.
 *
 * This module is shared by `server.ts` (the declaration) and
 * `src/provider-bridge.ts` (the bridge that emits the rows), so the two can
 * never disagree about a kind name or a schema. Everything here is plain
 * data plus zod — it bundles into the host artifact untouched.
 *
 * Only `@get-bb/plugin-sdk/*` and `zod` are imported anywhere in this plugin.
 * That is the rule this example exists to prove: a third-party provider
 * plugin reaches every capability through the public SDK alone.
 */
import type { PluginProviderFallbackModel } from "@get-bb/plugin-sdk";
import {
  type DeltaPresentation,
  experimental_presentationTitle as presentationTitle,
  experimental_withTitle as withTitle,
} from "@get-bb/plugin-sdk/provider-bridge";
import { z } from "zod";

/** `bb-plugin-echo-provider` → plugin id `echo-provider` (see package.json). */
export const ECHO_PLUGIN_ID = "echo-provider";

/** The provider id. Stable: thread rows persist it. */
export const ECHO_PROVIDER_ID = "echo-agent";

/** The one model the bridge lists. */
export const ECHO_MODEL_ID = "echo-1";

/**
 * That model as the declaration's cold-cache fallback and, with the wire
 * `model` id added, as the bridge's live `model/list` answer — one literal,
 * so the picker shows the same entry before and after the first probe.
 */
export const ECHO_MODEL = {
  id: ECHO_MODEL_ID,
  displayName: "Echo 1",
  description: "Repeats what it hears.",
  supportedReasoningEfforts: [
    { reasoningEffort: "low", description: "Whisper" },
    { reasoningEffort: "medium", description: "Speak" },
    { reasoningEffort: "high", description: "Shout" },
  ],
  defaultReasoningEffort: "medium",
  isDefault: true,
} satisfies PluginProviderFallbackModel;

// ---------------------------------------------------------------------------
// Extension kinds (docs/provider-plugin-api.md §3)
// ---------------------------------------------------------------------------

/**
 * `echo-provider/receipt` — an ITEM kind. One receipt per echoed prompt:
 * what was echoed and how much work the turn pretended to do. The server
 * validates every receipt against this schema at ingest; a payload that
 * misses it persists as `provider/unhandled` instead.
 */
export const ECHO_RECEIPT_KIND = `${ECHO_PLUGIN_ID}/receipt` as const;

export const echoReceiptSchema = z.object({
  prompt: z.string(),
  /** Number of timeline items the echo turn opened before the receipt. */
  itemCount: z.number().int().nonnegative(),
  /** Whether the "shout" setting upper-cased the echo. */
  shouted: z.boolean(),
});
export type EchoReceipt = z.infer<typeof echoReceiptSchema>;

/**
 * `echo-provider/mood` — a STATE kind. Latest snapshot wins per thread: the
 * bridge re-sends the whole value after every turn, never a diff.
 */
export const ECHO_MOOD_KIND = `${ECHO_PLUGIN_ID}/mood` as const;

export const echoMoodSchema = z.object({
  mood: z.enum(["cheerful", "bored"]),
  /** Turns this session has echoed so far. */
  turnsEchoed: z.number().int().nonnegative(),
});
export type EchoMood = z.infer<typeof echoMoodSchema>;

/** What `bb.providers.register` declares (`extensionKinds`). */
export const echoExtensionKinds = {
  receipt: { item: echoReceiptSchema },
  mood: { state: echoMoodSchema },
} as const;

// ---------------------------------------------------------------------------
// Provider options (plugin settings → bridge) and env passthrough
// ---------------------------------------------------------------------------

/**
 * The bag `deriveProviderOptions` returns on every command and
 * the bridge reads back from `options.providerOptions`. Core never
 * interprets it; the bridge validates it with this schema.
 */
export const echoProviderOptionsSchema = z.object({
  /** The plugin's `shout` setting (`bb.settings.define`). */
  shout: z.boolean(),
  /** The resolved model the server handed this command. */
  model: z.string(),
  /** `"plan"` when the composer entered plan mode through this provider. */
  promptMode: z.enum(["plan"]).nullable(),
});
export type EchoProviderOptions = z.infer<typeof echoProviderOptionsSchema>;

/**
 * The one daemon env var the bridge reads. Provider processes are spawned
 * with every inherited `BB_*` variable stripped; the declaration's
 * `env.passthrough` names this one so the daemon forwards it.
 */
export const ECHO_GREETING_ENV = "BB_ECHO_PROVIDER_GREETING";

/**
 * The workspace-relative directory the echo agent reads its own skills
 * from. The declaration's `experimental_nativeSkillRoots.project` names it so
 * bb lists those skills beside its own; the path is relative and has no dot
 * segments, the shape the registration validator enforces.
 */
export const ECHO_PROJECT_SKILL_ROOT = ".echo/skills";

// ---------------------------------------------------------------------------
// The bb tool this plugin ships (bb.agents.registerTool)
// ---------------------------------------------------------------------------

export const ECHO_STAMP_TOOL_NAME = "echo_stamp";

export const echoStampToolParametersSchema = z.object({
  text: z.string().min(1),
});

/**
 * How a call to `echo_stamp` reads as a timeline row. Declared once on the
 * tool registration; the server resolves it into the tool definition it
 * hands the bridge, and the bridge stamps it on the call's item beside
 * `server: "bb"` — no tool-name table anywhere.
 */
export const ECHO_STAMP_TOOL_PRESENTATION = {
  label: { pending: "Stamping receipt", completed: "Stamped receipt" },
  icon: { glyph: "Check" },
  tint: { light: "#1d4ed8", dark: "#93c5fd" },
} as const;

// ---------------------------------------------------------------------------
// Presentation for every row the bridge opens
// ---------------------------------------------------------------------------

export const AGENT_MESSAGE_PRESENTATION: DeltaPresentation = {
  label: { pending: "Echoing", completed: "Echoed" },
  icon: { glyph: "Repeat" },
};

export function commandPresentation(command: string): DeltaPresentation {
  return withTitle(
    {
      label: { pending: "Running command", completed: "Ran command" },
      icon: { glyph: "Terminal" },
    },
    presentationTitle(command),
  );
}

export function fileReadPresentation(path: string): DeltaPresentation {
  return withTitle(
    {
      label: { pending: "Reading file", completed: "Read file" },
      icon: { glyph: "FileText" },
    },
    presentationTitle(path),
  );
}

export function searchPresentation(query: string): DeltaPresentation {
  return withTitle(
    {
      label: { pending: "Searching files", completed: "Searched files" },
      icon: { glyph: "Search" },
    },
    presentationTitle(query),
  );
}

export function delegationPresentation(label: string): DeltaPresentation {
  return withTitle(
    {
      label: {
        pending: "Running echo child",
        completed: "Echo child finished",
      },
      icon: { glyph: "UserRound" },
      detail: "A scripted child turn, linked to this row through its parentRef.",
    },
    presentationTitle(label),
  );
}

export function planStepsPresentation(activeStep: string): DeltaPresentation {
  return withTitle(
    {
      label: { pending: "Updating plan", completed: "Updated plan" },
      icon: { glyph: "ListTodo" },
    },
    presentationTitle(activeStep),
  );
}

/** A low-value bookkeeping tool: clients collapse the row by default. */
export const NOOP_TOOL_PRESENTATION: DeltaPresentation = {
  label: { pending: "Clearing throat", completed: "Cleared throat" },
  icon: { glyph: "Toolbox" },
  suppress: true,
};

/**
 * The one icon this plugin ships (`bb.branding.experimental_icons` in
 * package.json, `icons/receipt.svg`), referenced by its namespaced glyph.
 * The server checks at ingest that the glyph names an icon this plugin
 * declares; clients draw the SVG tinted with the row's colour, and fall back
 * to the per-kind glyph if the plugin is gone.
 */
export const ECHO_RECEIPT_ICON_GLYPH = `${ECHO_PLUGIN_ID}/receipt` as const;

export function receiptPresentation(receipt: EchoReceipt): DeltaPresentation {
  return withTitle(
    {
      label: { pending: "Writing receipt", completed: "Wrote receipt" },
      icon: { glyph: ECHO_RECEIPT_ICON_GLYPH },
      detail: `Echoed ${receipt.itemCount} item${receipt.itemCount === 1 ? "" : "s"}${receipt.shouted ? ", shouting" : ""}.`,
      tint: { light: "#047857", dark: "#6ee7b7" },
    },
    presentationTitle(receipt.prompt),
  );
}
