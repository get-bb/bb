import type {
  ComposerCustomization,
  PluginComposerThreadRowStatus,
} from "@get-bb/plugin-sdk";
import { z } from "zod";

export const PLUGIN_SLOT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const PLUGIN_MESSAGE_DIRECTIVE_ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

type RejectionReporter = (reason: string) => void;

const objectSchema = z.object({}).passthrough();
const stringSchema = z.string();
const booleanSchema = z.boolean();
const functionSchema = z.function();
const toneSchema = z.enum(["default", "running", "success", "error"]);
const scopeSchema = z.enum([
  "thread",
  "queued-message",
  "side-chat",
  "new-thread",
]);

type RuntimeObject = z.output<typeof objectSchema>;

function parseObject<Value>(value: Value): RuntimeObject | null {
  const parsed = objectSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Parse the runtime value handed to
 * `PluginContentScriptContext.experimental_setThreadRowStatus`. `undefined`
 * means the value was rejected; `null` remains the explicit clear operation.
 */
export function normalizePluginThreadRowStatus<Value>(
  value: Value,
  onRejected: RejectionReporter,
): PluginComposerThreadRowStatus | null | undefined {
  const kind = "contentScript.experimental_setThreadRowStatus";
  if (value === null) return null;
  const status = parseObject(value);
  if (status === null) {
    onRejected(`${kind}: status must be null or a non-array object`);
    return undefined;
  }

  const icon = status.icon;
  const parsedIcon = stringSchema.safeParse(icon);
  if (!parsedIcon.success || parsedIcon.data.trim() === "") {
    onRejected(`${kind}: "icon" must be a non-blank string`);
    return undefined;
  }
  const label = status.label;
  const parsedLabel = stringSchema.safeParse(label);
  if (!parsedLabel.success || parsedLabel.data.trim() === "") {
    onRejected(`${kind}: "label" must be a non-blank string`);
    return undefined;
  }
  const tone = status.tone;
  const parsedTone = toneSchema.safeParse(tone);
  if (tone !== undefined && !parsedTone.success) {
    onRejected(
      `${kind}: "tone" must be "default", "running", "success", or "error" when set`,
    );
    return undefined;
  }

  const normalized: PluginComposerThreadRowStatus = {
    icon: parsedIcon.data.trim(),
    label: parsedLabel.data.trim(),
  };
  if (parsedTone.success) normalized.tone = parsedTone.data;
  return normalized;
}

export function requireSlotId<Value>(kind: string, value: Value): string {
  const parsed = stringSchema.safeParse(value);
  if (!parsed.success || !PLUGIN_SLOT_ID_PATTERN.test(parsed.data)) {
    throw new Error(
      `${kind}: "id" must match ${String(PLUGIN_SLOT_ID_PATTERN)}, got ${JSON.stringify(value)}`,
    );
  }
  return parsed.data;
}

/**
 * Provider ids follow the same character rules as slot ids, but they name a
 * provider the host knows (`codex`, `acp-cursor`), not a per-plugin slot.
 */
export function requireProviderId<Value>(kind: string, value: Value): string {
  const parsed = stringSchema.safeParse(value);
  if (!parsed.success || !PLUGIN_SLOT_ID_PATTERN.test(parsed.data)) {
    throw new Error(
      `${kind}: "providerId" must match ${String(PLUGIN_SLOT_ID_PATTERN)}, got ${JSON.stringify(value)}`,
    );
  }
  return parsed.data;
}

/**
 * A timeline renderer kind: `"tool"` (the plugin's providers' generic tool
 * items) or a namespaced extension kind `"<pluginId>/<name>"` (lowercase
 * letters, digits and `-` on both sides, the grammar of
 * `extensionKindSchema`). Ownership of the namespace is enforced by the host
 * against the loading plugin's id, which the collector does not know.
 */
export const PLUGIN_TIMELINE_RENDERER_KIND_PATTERN =
  /^(tool|[a-z0-9-]+\/[a-z0-9-]+)$/u;

export function requireTimelineRendererKind<Value>(
  kind: string,
  value: Value,
): string {
  const parsed = stringSchema.safeParse(value);
  if (
    !parsed.success ||
    !PLUGIN_TIMELINE_RENDERER_KIND_PATTERN.test(parsed.data)
  ) {
    throw new Error(
      `${kind}: "kind" must be "tool" or "<pluginId>/<name>" (lowercase letters, digits, "-"), got ${JSON.stringify(value)}`,
    );
  }
  return parsed.data;
}

export function requireMessageDirectiveId<Value>(
  kind: string,
  value: Value,
): string {
  const parsed = stringSchema.safeParse(value);
  if (
    !parsed.success ||
    !PLUGIN_MESSAGE_DIRECTIVE_ID_PATTERN.test(parsed.data)
  ) {
    throw new Error(
      `${kind}: "id" must match ${String(PLUGIN_MESSAGE_DIRECTIVE_ID_PATTERN)}, got ${JSON.stringify(value)}`,
    );
  }
  return parsed.data;
}

export function requireNonEmptyString<Value>(
  kind: string,
  field: string,
  value: Value,
): string {
  const parsed = stringSchema.safeParse(value);
  if (!parsed.success || parsed.data.length === 0) {
    throw new Error(`${kind}: "${field}" must be a non-empty string`);
  }
  return parsed.data;
}

export function requireOptionalString<Value>(
  kind: string,
  field: string,
  value: Value,
): string | undefined {
  const parsed = stringSchema.safeParse(value);
  if (value !== undefined && !parsed.success) {
    throw new Error(`${kind}: "${field}" must be a string when set`);
  }
  return parsed.success ? parsed.data : undefined;
}

export function requireComponent<T, Value = RuntimeObject[keyof RuntimeObject]>(
  kind: string,
  value: Value,
): T {
  const parsed = functionSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${kind}: "component" must be a React component function`);
  }
  /* SAFETY: The function schema verifies that the value is callable, and the caller supplies its declared component contract. */
  return value as T & Value;
}

function requireFunction<T, Value = RuntimeObject[keyof RuntimeObject]>(
  kind: string,
  field: string,
  value: Value,
): T {
  const parsed = functionSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${kind}: "${field}" must be a function`);
  }
  /* SAFETY: The function schema verifies that the value is callable, and the caller supplies its declared function contract. */
  return value as T & Value;
}

export function requireUniqueId(
  kind: string,
  seen: Set<string>,
  id: string,
): void {
  if (seen.has(id)) {
    throw new Error(`${kind}: duplicate id "${id}"`);
  }
  seen.add(id);
}

function parseContributionArray<T extends { id: string }, Value>(
  kind: string,
  value: Value,
  onRejected: RejectionReporter,
  parse: (entryKind: string, value: Value) => T,
): readonly T[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    onRejected(`${kind}: must be an array when set`);
    return undefined;
  }
  const seenIds = new Set<string>();
  const parsed: T[] = [];
  for (const [index, entry] of value.entries()) {
    const entryKind = `${kind}[${index}]`;
    try {
      const parsedEntry = parse(entryKind, entry);
      requireUniqueId(entryKind, seenIds, parsedEntry.id);
      parsed.push(parsedEntry);
    } catch (error) {
      onRejected(error instanceof Error ? error.message : String(error));
    }
  }
  return parsed;
}

function parseRegions(
  kind: string,
  registration: RuntimeObject,
  onRejected: RejectionReporter,
): Pick<
  ComposerCustomization,
  "actions" | "banners" | "plusMenu" | "richText"
> {
  const actions = parseContributionArray<
    NonNullable<ComposerCustomization["actions"]>[number],
    RuntimeObject["actions"]
  >(`${kind}.actions`, registration.actions, onRejected, (entryKind, value) => {
    const entry = parseObject(value);
    return {
      id: requireSlotId(entryKind, entry?.id),
      component: requireComponent(entryKind, entry?.component),
    };
  });
  const banners = parseContributionArray<
    NonNullable<ComposerCustomization["banners"]>[number],
    RuntimeObject["banners"]
  >(`${kind}.banners`, registration.banners, onRejected, (entryKind, value) => {
    const entry = parseObject(value);
    const id = requireSlotId(entryKind, entry?.id);
    const chrome = entry?.chrome;
    const parsedChrome = z.enum(["card", "bare"]).safeParse(chrome);
    if (chrome !== undefined && !parsedChrome.success) {
      throw new Error(
        `${entryKind}: "chrome" must be "card" or "bare" when set`,
      );
    }
    const banner: NonNullable<ComposerCustomization["banners"]>[number] = {
      id,
      component: requireComponent(entryKind, entry?.component),
    };
    if (parsedChrome.success) banner.chrome = parsedChrome.data;
    return banner;
  });
  const plusMenu = parseContributionArray<
    NonNullable<ComposerCustomization["plusMenu"]>[number],
    RuntimeObject["plusMenu"]
  >(
    `${kind}.plusMenu`,
    registration.plusMenu,
    onRejected,
    (entryKind, value) => {
      const entry = parseObject(value);
      const id = requireSlotId(entryKind, entry?.id);
      const icon = requireOptionalString(entryKind, "icon", entry?.icon);
      const description = requireOptionalString(
        entryKind,
        "description",
        entry?.description,
      );
      const disabled = entry?.disabled;
      const parsedDisabledBoolean = booleanSchema.safeParse(disabled);
      const parsedDisabledFunction = functionSchema.safeParse(disabled);
      if (
        disabled !== undefined &&
        !parsedDisabledBoolean.success &&
        !parsedDisabledFunction.success
      ) {
        throw new Error(
          `${entryKind}: "disabled" must be a boolean or function when set`,
        );
      }
      const plusMenuItem: NonNullable<
        ComposerCustomization["plusMenu"]
      >[number] = {
        id,
        label: requireNonEmptyString(entryKind, "label", entry?.label),
        run: requireFunction<
          NonNullable<ComposerCustomization["plusMenu"]>[number]["run"]
        >(entryKind, "run", entry?.run),
      };
      if (icon !== undefined) plusMenuItem.icon = icon;
      if (description !== undefined) plusMenuItem.description = description;
      if (parsedDisabledBoolean.success) {
        plusMenuItem.disabled = parsedDisabledBoolean.data;
      } else if (parsedDisabledFunction.success) {
        plusMenuItem.disabled = requireFunction<
          NonNullable<ComposerCustomization["plusMenu"]>[number]["disabled"]
        >(entryKind, "disabled", disabled);
      }
      return plusMenuItem;
    },
  );

  let richText: ComposerCustomization["richText"];
  if (registration.richText !== undefined) {
    const raw = parseObject(registration.richText);
    if (raw === null) {
      onRejected(`${kind}.richText: must be an object when set`);
    } else {
      const effects = parseContributionArray<
        NonNullable<
          NonNullable<ComposerCustomization["richText"]>["effects"]
        >[number],
        RuntimeObject["effects"]
      >(
        `${kind}.richText.effects`,
        raw.effects,
        onRejected,
        (entryKind, value) => {
          const entry = parseObject(value);
          return {
            id: requireSlotId(entryKind, entry?.id),
            match: requireFunction<
              NonNullable<
                NonNullable<ComposerCustomization["richText"]>["effects"]
              >[number]["match"]
            >(entryKind, "match", entry?.match),
            className: requireNonEmptyString(
              entryKind,
              "className",
              entry?.className,
            ),
          };
        },
      );
      const onDraftChange = raw.onDraftChange;
      const parsedOnDraftChange = functionSchema.safeParse(onDraftChange);
      if (onDraftChange !== undefined && !parsedOnDraftChange.success) {
        onRejected(
          `${kind}.richText: "onDraftChange" must be a function when set`,
        );
      }
      const parsedRichText: NonNullable<ComposerCustomization["richText"]> = {};
      if (effects !== undefined) parsedRichText.effects = effects;
      if (parsedOnDraftChange.success) {
        parsedRichText.onDraftChange = requireFunction<
          NonNullable<ComposerCustomization["richText"]>["onDraftChange"]
        >(kind, "onDraftChange", onDraftChange);
      }
      richText = parsedRichText;
    }
  }

  const regions: Pick<
    ComposerCustomization,
    "actions" | "banners" | "plusMenu" | "richText"
  > = {};
  if (actions !== undefined) regions.actions = actions;
  if (banners !== undefined) regions.banners = banners;
  if (plusMenu !== undefined) regions.plusMenu = plusMenu;
  if (richText !== undefined) regions.richText = richText;
  return regions;
}

/**
 * Validate one registration while isolating composer customization failures.
 * The host and test harness inject their own rejection reporters.
 */
export function collectComposerCustomization<Value>(
  registration: Value,
  seenIds: Set<string>,
  onRejected: RejectionReporter,
): ComposerCustomization | null {
  const kind = "composer.customize";
  try {
    const raw = parseObject(registration);
    const id = requireSlotId(kind, raw?.id);
    const scopes = raw?.scopes;
    let parsedScopes: NonNullable<ComposerCustomization["scopes"]> | undefined;
    if (scopes !== undefined) {
      if (!Array.isArray(scopes)) {
        throw new Error(`${kind}: "scopes" must be an array when set`);
      }
      const validScopes: NonNullable<
        ComposerCustomization["scopes"]
      >[number][] = [];
      for (const scope of scopes) {
        const parsedScope = scopeSchema.safeParse(scope);
        if (!parsedScope.success) {
          throw new Error(
            `${kind}: invalid scope kind ${JSON.stringify(scope)}`,
          );
        }
        validScopes.push(parsedScope.data);
      }
      parsedScopes = validScopes;
    }
    requireUniqueId(kind, seenIds, id);
    const customization: ComposerCustomization = {
      id,
      ...parseRegions(
        `${kind}(${id})`,
        raw ?? objectSchema.parse({}),
        onRejected,
      ),
    };
    if (parsedScopes !== undefined) customization.scopes = parsedScopes;
    return customization;
  } catch (error) {
    onRejected(error instanceof Error ? error.message : String(error));
    return null;
  }
}
