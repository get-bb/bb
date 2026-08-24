/**
 * Guardrail G10 — docs/provider-plugin-api.md stays true to the types.
 *
 * The target-state doc describes the surface every provider workstream keeps
 * true. Its ```ts blocks are target-state pseudo-code (the registration block
 * uses the stabilized names the `experimental_` fields will take;
 * `TimelineRow { kind, payload, presentation }` is a sketch), so they cannot
 * be compiled as-is. This test does the next best thing and does it
 * mechanically:
 *
 *  1. every ```ts block is extracted and its field names parsed;
 *  2. each block is mapped, field by field, onto the real contract — a zod
 *     schema key, a TypeScript interface key (checked at the type level with
 *     `satisfies`), or an explicit `gap` naming the workstream that lands it;
 *  3. a gap that has quietly landed fails (the schema now has the key), so the
 *     map can only move toward "no gaps";
 *  4. a doc edit that adds, removes, or renames a block or a field fails until
 *     this map is updated, which is the review hook.
 *
 * TODO(WS-final, stabilization): once the doc's blocks are real code (the
 * registration API, the timeline renderer slot, `TimelineRow.presentation`),
 * replace the field maps with an actual compile of the blocks through the
 * TypeScript compiler API against the published `bundled-types/` bundle.
 */
import { readFile } from "node:fs/promises";
import {
  bridgeCapabilitiesSchema,
  bridgeExecutionOptionsSchema,
  providerRecoveryNotificationSchema,
} from "@bb/provider-bridge-protocol";
import {
  providerRecoveryKindValues,
  threadEventDelegationItemSchema,
  threadEventItemPresentationSchema,
  type ThreadEventItemPresentation,
} from "@bb/domain";
import {
  timelineCommandWorkRowSchema,
  type TimelineCommandWorkRow,
} from "@bb/server-contract";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import type { PluginAppSlots } from "../app-contract.js";
import type {
  PluginProviderCapabilities,
  PluginProviderDeclaration,
  PluginProviderStrings,
} from "../backend-contract.js";
import * as providerBridgeSdk from "../provider-bridge.js";
import * as providerBridgeTestingSdk from "../provider-bridge-testing.js";

const DOC_URL = new URL(
  "../../../../docs/provider-plugin-api.md",
  import.meta.url,
);

// ---------------------------------------------------------------------------
// Field maps. A value is where the field lives today, or `{ gap }` naming the
// workstream that lands it.
// ---------------------------------------------------------------------------

type Gap = { gap: `WS${string}` };

type DeclarationPath =
  | keyof PluginProviderDeclaration
  | `capabilities.${keyof PluginProviderCapabilities}`
  | `strings.${keyof PluginProviderStrings}`;

/** §1 `bb.providers.register({...})` → `PluginProviderDeclaration`. */
const REGISTRATION_FIELDS = {
  id: "id",
  displayName: "displayName",
  family: "family",
  icon: "icon",
  strings: "strings",
  signInHint: "strings.signInHint",
  expiredHint: "strings.expiredHint",
  installUrl: "strings.installUrl",
  brandPrefix: "strings.brandPrefix",
  planModeCopy: "strings.planModeCopy",
  iconTint: "strings.iconTint",
  capabilities: "capabilities",
  permissionModes: "capabilities.permissionModes",
  reasoningLevels: "reasoningLevels",
  serviceTiers: "serviceTiers",
  fork: "capabilities.fork",
  supportsNativeUserQuestion: "capabilities.supportsNativeUserQuestion",
  supportsManualCompaction: "capabilities.supportsManualCompaction",
  supportsThreadArchive: "capabilities.supportsThreadArchive",
  supportsThreadRename: "capabilities.supportsThreadRename",
  supportsServiceTier: "capabilities.supportsServiceTier",
  maintenance: "maintenance",
  composerActions: "composerActions",
  extensionKinds: "extensionKinds",
  models: "models",
  env: "env",
  deriveProviderOptions: "deriveProviderOptions",
} as const satisfies Record<string, DeclarationPath | Gap>;

type DeclarationGapKeys = {
  [K in keyof typeof REGISTRATION_FIELDS]: (typeof REGISTRATION_FIELDS)[K] extends Gap
    ? K
    : never;
}[keyof typeof REGISTRATION_FIELDS];
type DeclarationGapsNotLanded = Extract<
  DeclarationGapKeys,
  keyof PluginProviderDeclaration | keyof PluginProviderCapabilities
>;

/** §2 handshake block → `bridgeCapabilitiesSchema`. */
const HANDSHAKE_FIELDS = {
  grammarVersions: "grammarVersions",
  sessionRestore: "sessionRestore",
  threadArchive: "threadArchive",
  threadRename: "threadRename",
  threadGoalClear: "threadGoalClear",
  fork: "fork",
  approvalEnforcedBy: "approvalEnforcedBy",
  steerMode: "steerMode",
  skills: "skills",
} as const satisfies Record<
  string,
  keyof z.infer<typeof bridgeCapabilitiesSchema> | Gap
>;

/** §2 execution options block → `bridgeExecutionOptionsSchema`. */
const EXECUTION_OPTION_FIELDS = {
  model: "model",
  serviceTier: "serviceTier",
  reasoningLevel: "reasoningLevel",
  promptMode: "promptMode",
  instructions: "instructions",
  providerOptions: "providerOptions",
} as const satisfies Record<
  string,
  keyof z.infer<typeof bridgeExecutionOptionsSchema> | Gap
>;

/** §2 `provider/recovery` block → `providerRecoveryNotificationSchema`. */
const RECOVERY_FIELDS = {
  kind: "kind",
  message: "message",
  retryable: "retryable",
} as const satisfies Record<
  string,
  keyof z.infer<typeof providerRecoveryNotificationSchema> | Gap
>;

/** §3 delegation block → `threadEventDelegationItemSchema`. */
const DELEGATION_FIELDS = {
  childRef: "childRef",
  label: "label",
  status: "status",
  background: "background",
  summary: "summary",
} as const satisfies Record<
  string,
  keyof z.infer<typeof threadEventDelegationItemSchema> | Gap
>;

/** §3 presentation block → `threadEventItemPresentationSchema`. */
type PresentationPath =
  | "presentation"
  | keyof ThreadEventItemPresentation
  | `label.${keyof ThreadEventItemPresentation["label"]}`
  | `icon.${keyof ThreadEventItemPresentation["icon"]}`
  | `tint.${keyof NonNullable<ThreadEventItemPresentation["tint"]>}`;

const PRESENTATION_FIELDS = {
  presentation: "presentation",
  label: "label",
  pending: "label.pending",
  completed: "label.completed",
  icon: "icon",
  // A host glyph or a plugin-declared icon by its namespaced glyph
  // ("<pluginId>/<name>"); the one persisted field serves both.
  glyph: "icon.glyph",
  title: "title",
  detail: "detail",
  suppress: "suppress",
  tint: "tint",
  light: "tint.light",
  dark: "tint.dark",
} as const satisfies Record<string, PresentationPath | Gap>;

/**
 * §5 `TimelineRow { kind, payload, presentation }` → a representative work
 * row (type level and its schema at runtime).
 */
const TIMELINE_ROW_FIELDS = {
  kind: "kind",
  // Rows keep typed per-kind fields (a `file-read` row has `path`, a
  // `search` row `mode`/`query`); only the `extension` row carries an opaque
  // `payload`. The fold of every kind's body into one field is not landed.
  payload: {
    gap: "WS3 (projection): one folded `payload` for every kind; rows stay typed per kind and only extension rows carry `payload`",
  },
  presentation: "presentation",
} as const satisfies Record<string, keyof TimelineCommandWorkRow | Gap>;
type TimelineRowGapsNotLanded = Extract<"payload", keyof TimelineCommandWorkRow>;

/** §5 `app.slots.timelineRenderer` → `PluginAppSlots` (experimental_ until audited). */
type TimelineRendererSlot = PluginAppSlots["experimental_timelineRenderer"];

// ---------------------------------------------------------------------------
// Doc parsing
// ---------------------------------------------------------------------------

function extractTsBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/```ts\n([\s\S]*?)```/gu)].map(
    (match) => match[1] ?? "",
  );
}

/**
 * `  foo?: string,` / `foo: {` / `foo(ctx) {` / `{ foo: string` → "foo".
 * One field per line after the caller splits one-line object types on commas;
 * comments are ignored.
 */
function fieldNames(block: string): string[] {
  const names = new Set<string>();
  for (const rawLine of block.split("\n")) {
    const line = rawLine.replace(/\/\/.*$/u, "");
    const match = /^\s*\{?\s*([A-Za-z_][A-Za-z0-9_]*)\??\s*[:(]/u.exec(line);
    if (match?.[1]) names.add(match[1]);
  }
  return [...names].sort();
}

/** `{ model, serviceTier?, providerOptions: JsonValue } & P` → the bare names. */
function bareFieldNames(block: string): string[] {
  const body = block.replace(/\/\/.*$/gmu, "").split("&")[0] ?? "";
  return [
    ...new Set(
      [...body.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\??(?=\s*(?:,|:|\}))/gu)].map(
        (match) => match[1] ?? "",
      ),
    ),
  ].sort();
}

function isGap(value: unknown): value is Gap {
  return typeof value === "object" && value !== null && "gap" in value;
}

function landedKeys(map: Record<string, unknown>): string[] {
  return Object.keys(map).filter((key) => !isGap(map[key]));
}

function gapKeys(map: Record<string, unknown>): string[] {
  return Object.keys(map).filter((key) => isGap(map[key]));
}

function schemaKeys(schema: z.ZodType): Set<string> {
  const def = schema._zod.def;
  if (def.type === "object") {
    const shape = Reflect.get(def, "shape");
    return new Set(
      typeof shape === "object" && shape !== null ? Object.keys(shape) : [],
    );
  }
  if (def.type === "intersection") {
    const left = Reflect.get(def, "left");
    const right = Reflect.get(def, "right");
    return new Set([
      ...(left ? schemaKeys(left as z.ZodType) : []),
      ...(right ? schemaKeys(right as z.ZodType) : []),
    ]);
  }
  return new Set();
}

function expectGapsNotLanded(
  map: Record<string, unknown>,
  present: Set<string>,
  where: string,
): void {
  const landed = gapKeys(map).filter((key) => present.has(key));
  expect(
    landed,
    `${where}: these doc fields are marked as gaps but now exist — move them from { gap } to their real path`,
  ).toEqual([]);
}

function expectLandedPresent(
  map: Record<string, string | Gap>,
  present: Set<string>,
  where: string,
): void {
  const missing = landedKeys(map).filter((key) => {
    const path = map[key];
    if (isGap(path) || path === undefined) return false;
    const root = path.split(".")[0] ?? path;
    return !present.has(root);
  });
  expect(
    missing,
    `${where}: the doc names these fields but the schema no longer has them`,
  ).toEqual([]);
}

// ---------------------------------------------------------------------------

describe("guardrail G10: docs/provider-plugin-api.md matches the contract", () => {
  it("has exactly the code blocks this test maps, in order", async () => {
    const blocks = extractTsBlocks(await readFile(DOC_URL, "utf8"));
    const headings = blocks.map((block) => block.split("\n")[0]?.trim());
    expect(headings).toEqual([
      "bb.providers.register({",
      "export const experimental_providerBridge = experimental_defineProviderBridge({",
      "{",
      "{ model, serviceTier?, reasoningLevel, promptMode?, instructions,",
      "// provider/recovery",
      "{ childRef: string, label: string, status: ItemStatus,",
      "presentation: {",
      "TimelineRow { kind: string, payload, presentation }",
      "app.slots.experimental_timelineRenderer({ kind, component })",
    ]);
  });

  it("§1 registration fields map onto PluginProviderDeclaration or a named gap", async () => {
    const [registration] = extractTsBlocks(await readFile(DOC_URL, "utf8"));
    expect(fieldNames(registration ?? "")).toEqual(
      Object.keys(REGISTRATION_FIELDS).sort(),
    );
    // Type-level: a gap that landed on the declaration turns this into a
    // non-never union and fails `tsc`.
    expectTypeOf<DeclarationGapsNotLanded>().toBeNever();
  });

  it("§2 the bridge entry point is exported from @get-bb/plugin-sdk/provider-bridge", () => {
    // The doc names it with the prefix it still carries; the export keeps the
    // experimental_ prefix until the stabilization audit drops it.
    expect(typeof providerBridgeSdk.experimental_defineProviderBridge).toBe(
      "function",
    );
  });

  it("§2 the assembler ships with the conformance kit and JSON-RPC harness as provider-bridge/testing", () => {
    // The doc names the entry `@get-bb/plugin-sdk/provider-bridge/testing`;
    // the value exports carry the experimental_ prefix until stabilization.
    expect(
      typeof providerBridgeTestingSdk.experimental_createDeltaAssembler,
    ).toBe("function");
    expect(
      typeof providerBridgeTestingSdk.experimental_runBridgeConformance,
    ).toBe("function");
    expect(
      typeof providerBridgeTestingSdk.experimental_createBridgeJsonRpcTestHarness,
    ).toBe("function");
    expect(
      typeof providerBridgeTestingSdk.experimental_normalizeCalibrationEvents,
    ).toBe("function");
  });

  it("§2 handshake, execution options and recovery fields match the protocol schemas", async () => {
    const [, , handshake, executionOptions, recovery] = extractTsBlocks(
      await readFile(DOC_URL, "utf8"),
    );
    expect(fieldNames(handshake ?? "")).toEqual(
      Object.keys(HANDSHAKE_FIELDS).sort(),
    );
    const capabilityKeys = schemaKeys(bridgeCapabilitiesSchema);
    expectLandedPresent(HANDSHAKE_FIELDS, capabilityKeys, "handshake");
    expectGapsNotLanded(HANDSHAKE_FIELDS, capabilityKeys, "handshake");

    // The doc writes the options as a one-line type with bare names.
    expect(
      bareFieldNames(executionOptions ?? "").filter(
        (name) => name !== "JsonValue",
      ),
    ).toEqual(Object.keys(EXECUTION_OPTION_FIELDS).sort());
    const optionKeys = schemaKeys(bridgeExecutionOptionsSchema);
    expectLandedPresent(
      EXECUTION_OPTION_FIELDS,
      optionKeys,
      "execution options",
    );
    expectGapsNotLanded(
      EXECUTION_OPTION_FIELDS,
      optionKeys,
      "execution options",
    );

    const recoveryBlock = recovery ?? "";
    expect(fieldNames(recoveryBlock.replaceAll(",", ",\n"))).toEqual(
      Object.keys(RECOVERY_FIELDS).sort(),
    );
    const recoveryKeys = schemaKeys(providerRecoveryNotificationSchema);
    expectLandedPresent(RECOVERY_FIELDS, recoveryKeys, "provider/recovery");
    const documentedKinds = [...recoveryBlock.matchAll(/"([A-Za-z]+)"/gu)]
      .map((match) => match[1])
      .sort();
    expect(documentedKinds).toEqual([...providerRecoveryKindValues].sort());
  });

  it("§3 delegation and presentation fields match the domain schemas", async () => {
    const [, , , , , delegation, presentation] = extractTsBlocks(
      await readFile(DOC_URL, "utf8"),
    );
    expect(fieldNames((delegation ?? "").replaceAll(",", ",\n"))).toEqual(
      Object.keys(DELEGATION_FIELDS).sort(),
    );
    expectLandedPresent(
      DELEGATION_FIELDS,
      schemaKeys(threadEventDelegationItemSchema),
      "delegation",
    );

    expect(
      fieldNames(
        // `label: { pending: string, completed: string }` sits on one line.
        (presentation ?? "").replaceAll(",", ",\n").replaceAll("{", "{\n"),
      ),
    ).toEqual(Object.keys(PRESENTATION_FIELDS).sort());
    const presentationKeys = schemaKeys(threadEventItemPresentationSchema);
    presentationKeys.add("presentation");
    expectLandedPresent(PRESENTATION_FIELDS, presentationKeys, "presentation");
  });

  it("§5 presentation rides every work row and the renderer slot exists (WS3)", () => {
    const rowKeys = schemaKeys(timelineCommandWorkRowSchema);
    expectLandedPresent(TIMELINE_ROW_FIELDS, rowKeys, "TimelineRow");
    expectGapsNotLanded(TIMELINE_ROW_FIELDS, rowKeys, "TimelineRow");
    expectTypeOf<TimelineRowGapsNotLanded>().toBeNever();
    expectTypeOf<TimelineRendererSlot>().toBeFunction();
  });
});
