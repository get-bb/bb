import type {
  ComposerCustomization,
  ComposerPlusMenuItem,
  PluginComposerScope,
} from "@get-bb/plugin-sdk";
import {
  AUTOMATIC_REPLACEMENT_PROVIDER,
  NO_AUTOMATIC_RULE,
  REPLACEMENT_RULE,
  resolveExclusive,
  type ExclusiveBootState,
} from "./plugin-replacement-preference";
import type {
  PluginCodeFenceRendererSlot,
  PluginComposerCustomizationSlot,
  PluginFileOpenerSlot,
  PluginMessageDirectiveSlot,
  PluginPendingInteractionSlot,
  PluginTimelineRendererSlot,
} from "./plugin-slots";

type ComposerAction = NonNullable<ComposerCustomization["actions"]>[number];
type ComposerBanner = NonNullable<ComposerCustomization["banners"]>[number];
type ComposerEditorEffect = NonNullable<
  NonNullable<ComposerCustomization["richText"]>["effects"]
>[number];
type ComposerDraftObserver = NonNullable<
  NonNullable<ComposerCustomization["richText"]>["onDraftChange"]
>;

interface ResolvedComposerContribution {
  key: string;
  pluginId: string;
  customizationId: string;
  generation: number;
}

export interface ResolvedComposerAction extends ResolvedComposerContribution {
  action: ComposerAction;
}

interface ResolvedComposerBanner extends ResolvedComposerContribution {
  banner: ComposerBanner;
}

export interface ResolvedComposerPlusMenuItem extends ResolvedComposerContribution {
  item: ComposerPlusMenuItem;
}

interface ResolvedComposerEditorEffects extends ResolvedComposerContribution {
  effects: readonly ComposerEditorEffect[];
}

interface ResolvedComposerDraftObserver extends ResolvedComposerContribution {
  onDraftChange: ComposerDraftObserver;
}

function composerContributionKey(
  customization: PluginComposerCustomizationSlot,
  contributionId: string,
): string {
  return [
    customization.pluginId,
    customization.generation,
    customization.id,
    contributionId,
  ].join("/");
}

function resolvedComposerContribution(
  customization: PluginComposerCustomizationSlot,
  contributionId: string,
): ResolvedComposerContribution {
  return {
    key: composerContributionKey(customization, contributionId),
    pluginId: customization.pluginId,
    customizationId: customization.id,
    generation: customization.generation,
  };
}

function composerCustomizationApplies(
  customization: PluginComposerCustomizationSlot,
  scopeKind: PluginComposerScope["kind"],
): boolean {
  return (
    customization.scopes === undefined ||
    customization.scopes.includes(scopeKind)
  );
}

export function resolveComposerActions(
  customizations: readonly PluginComposerCustomizationSlot[],
  scopeKind: PluginComposerScope["kind"],
): readonly ResolvedComposerAction[] {
  const resolved: ResolvedComposerAction[] = [];
  for (const customization of customizations) {
    if (!composerCustomizationApplies(customization, scopeKind)) continue;
    for (const action of customization.actions ?? []) {
      resolved.push({
        ...resolvedComposerContribution(customization, action.id),
        action,
      });
    }
  }
  return resolved;
}

export function resolveComposerBanners(
  customizations: readonly PluginComposerCustomizationSlot[],
  scopeKind: PluginComposerScope["kind"],
): readonly ResolvedComposerBanner[] {
  const resolved: ResolvedComposerBanner[] = [];
  for (const customization of customizations) {
    if (!composerCustomizationApplies(customization, scopeKind)) continue;
    for (const banner of customization.banners ?? []) {
      resolved.push({
        ...resolvedComposerContribution(customization, banner.id),
        banner,
      });
    }
  }
  return resolved;
}

export function resolveComposerPlusMenuItems(
  customizations: readonly PluginComposerCustomizationSlot[],
  scopeKind: PluginComposerScope["kind"],
): readonly ResolvedComposerPlusMenuItem[] {
  const resolved: ResolvedComposerPlusMenuItem[] = [];
  for (const customization of customizations) {
    if (!composerCustomizationApplies(customization, scopeKind)) continue;
    for (const item of customization.plusMenu ?? []) {
      resolved.push({
        ...resolvedComposerContribution(customization, item.id),
        item,
      });
    }
  }
  return resolved;
}

export function resolveComposerSendMenuItems(
  customizations: readonly PluginComposerCustomizationSlot[],
  scopeKind: PluginComposerScope["kind"],
): readonly ResolvedComposerPlusMenuItem[] {
  const resolved: ResolvedComposerPlusMenuItem[] = [];
  for (const customization of customizations) {
    if (!composerCustomizationApplies(customization, scopeKind)) continue;
    for (const item of customization.sendMenu ?? []) {
      resolved.push({
        ...resolvedComposerContribution(customization, item.id),
        item,
      });
    }
  }
  return resolved;
}

export function resolveComposerEditorEffects(
  customizations: readonly PluginComposerCustomizationSlot[],
  scopeKind: PluginComposerScope["kind"],
): readonly ResolvedComposerEditorEffects[] {
  const resolved: ResolvedComposerEditorEffects[] = [];
  for (const customization of customizations) {
    if (!composerCustomizationApplies(customization, scopeKind)) continue;
    const effects = customization.richText?.effects;
    if (effects === undefined || effects.length === 0) continue;
    resolved.push({
      ...resolvedComposerContribution(customization, "editor-effects"),
      effects,
    });
  }
  return resolved;
}

export function resolveComposerDraftObservers(
  customizations: readonly PluginComposerCustomizationSlot[],
  scopeKind: PluginComposerScope["kind"],
): readonly ResolvedComposerDraftObserver[] {
  const resolved: ResolvedComposerDraftObserver[] = [];
  for (const customization of customizations) {
    if (!composerCustomizationApplies(customization, scopeKind)) continue;
    const onDraftChange = customization.richText?.onDraftChange;
    if (onDraftChange === undefined) continue;
    resolved.push({
      ...resolvedComposerContribution(customization, "draft-observer"),
      onDraftChange,
    });
  }
  return resolved;
}

export function resolvePendingInteraction(
  registrations: readonly PluginPendingInteractionSlot[],
  pluginId: string,
  rendererId: string,
): PluginPendingInteractionSlot | null {
  return (
    registrations.find(
      (registration) =>
        registration.pluginId === pluginId && registration.id === rendererId,
    ) ?? null
  );
}

export function resolveTimelineRenderer(
  registrations: readonly PluginTimelineRendererSlot[],
  target:
    | { kind: "extension"; extensionKind: string }
    | { kind: "form"; pluginId: string; rendererId: string }
    | { kind: "tool"; providerPluginId: string | null },
): PluginTimelineRendererSlot | null {
  if (target.kind === "extension") {
    return (
      registrations.find(
        (registration) => registration.kind === target.extensionKind,
      ) ?? null
    );
  }
  if (target.kind === "form") {
    const kind = `${target.pluginId}/${target.rendererId}`;
    return (
      registrations.find(
        (registration) =>
          registration.pluginId === target.pluginId &&
          registration.kind === kind,
      ) ?? null
    );
  }
  if (target.providerPluginId === null) {
    return null;
  }
  return (
    registrations.find(
      (registration) =>
        registration.kind === "tool" &&
        registration.pluginId === target.providerPluginId,
    ) ?? null
  );
}

export type ResolvedMessageDirective =
  | { status: "ok"; slot: PluginMessageDirectiveSlot }
  | { status: "loading" }
  | { status: "literal" }
  | { status: "collision"; pluginIds: readonly string[] };

function groupClaimants<Slot>(
  registrations: readonly Slot[],
  keysOf: (registration: Slot) => readonly string[],
): Map<string, Slot[]> {
  const claimantsByKey = new Map<string, Slot[]>();
  for (const registration of registrations) {
    for (const key of keysOf(registration)) {
      const claimants = claimantsByKey.get(key);
      if (claimants === undefined) {
        claimantsByKey.set(key, [registration]);
      } else {
        claimants.push(registration);
      }
    }
  }
  return claimantsByKey;
}

function distinctPluginIds(
  claimants: readonly { pluginId: string }[],
): readonly string[] {
  return [...new Set(claimants.map((claimant) => claimant.pluginId))].sort();
}

export function resolveMessageDirectiveRegistry(
  registrations: readonly PluginMessageDirectiveSlot[],
  picks: Readonly<Record<string, string>>,
  boot: ExclusiveBootState,
): ReadonlyMap<string, ResolvedMessageDirective> {
  const resolved = new Map<string, ResolvedMessageDirective>();
  for (const [name, claimants] of groupClaimants(
    registrations,
    (registration) => [registration.id],
  )) {
    const directive = resolveExclusive({
      claimants,
      pick: picks[name] ?? AUTOMATIC_REPLACEMENT_PROVIDER,
      rememberedAutomatic: null,
      rule: NO_AUTOMATIC_RULE,
      ...boot,
    });
    switch (directive.kind) {
      case "plugin":
        resolved.set(name, { status: "ok", slot: directive.registration });
        break;
      case "loading":
        resolved.set(name, { status: "loading" });
        break;
      case "builtin":
        resolved.set(name, { status: "literal" });
        break;
      case "contested":
        resolved.set(name, {
          status: "collision",
          pluginIds: distinctPluginIds(claimants),
        });
        break;
    }
  }
  return resolved;
}

export type ResolvedCodeFenceRenderer =
  | { status: "ok"; slot: PluginCodeFenceRendererSlot }
  | { status: "builtin" };

export function resolveCodeFenceRendererRegistry(
  registrations: readonly PluginCodeFenceRendererSlot[],
  picks: Readonly<Record<string, string>>,
  boot: ExclusiveBootState,
): ReadonlyMap<string, ResolvedCodeFenceRenderer> {
  const resolved = new Map<string, ResolvedCodeFenceRenderer>();
  for (const [language, claimants] of groupClaimants(
    registrations,
    (registration) => registration.languages,
  )) {
    const renderer = resolveExclusive({
      claimants,
      pick: picks[language] ?? AUTOMATIC_REPLACEMENT_PROVIDER,
      rememberedAutomatic: null,
      rule: REPLACEMENT_RULE,
      ...boot,
    });
    resolved.set(
      language,
      renderer.kind === "plugin"
        ? { status: "ok", slot: renderer.registration }
        : { status: "builtin" },
    );
  }
  return resolved;
}

export type ResolvedReplacement<Registration> =
  | { kind: "owner" }
  | { kind: "plugin"; registration: Registration };

const OWNER_REPLACEMENT: ResolvedReplacement<never> = { kind: "owner" };

export function resolveReplacement<Registration>(
  registrations: readonly Registration[],
  applies?: (registration: Registration) => boolean,
): ResolvedReplacement<Registration> {
  const registration =
    applies === undefined
      ? registrations[0]
      : registrations.find((candidate) => applies(candidate));
  return registration === undefined
    ? OWNER_REPLACEMENT
    : { kind: "plugin", registration };
}

export type FileOpenerOverride =
  | "builtin"
  | { pluginId: string; openerId: string };

export type FileOpenerPreferenceMap = Readonly<Record<string, string>>;

export function getFileExtension(path: string): string | null {
  const name = path.split("/").at(-1) ?? path;
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === name.length - 1) return null;
  return name.slice(dotIndex + 1).toLowerCase();
}

export function resolveFileOpenerReplacement(args: {
  registrations: readonly PluginFileOpenerSlot[];
  picks: FileOpenerPreferenceMap;
  path: string;
  override?: FileOpenerOverride;
  boot: ExclusiveBootState;
}): ResolvedReplacement<PluginFileOpenerSlot> {
  const override = args.override;
  if (override === "builtin") return OWNER_REPLACEMENT;
  if (override !== undefined) {
    return resolveReplacement(
      args.registrations,
      (candidate) =>
        candidate.pluginId === override.pluginId &&
        candidate.id === override.openerId,
    );
  }

  const extension = getFileExtension(args.path);
  if (extension === null) return OWNER_REPLACEMENT;
  const resolved = resolveExclusive({
    claimants: args.registrations.filter((candidate) =>
      candidate.extensions.includes(extension),
    ),
    pick: args.picks[extension] ?? AUTOMATIC_REPLACEMENT_PROVIDER,
    rememberedAutomatic: null,
    rule: REPLACEMENT_RULE,
    ...args.boot,
  });
  return resolved.kind === "plugin"
    ? { kind: "plugin", registration: resolved.registration }
    : OWNER_REPLACEMENT;
}

export function resolveComposerPopups(
  customizations: readonly PluginComposerCustomizationSlot[],
  scopeKind: PluginComposerScope["kind"],
) {
  return customizations.flatMap((customization) =>
    composerCustomizationApplies(customization, scopeKind)
      ? (customization.experimental_popups ?? []).map((popup) => ({
          ...resolvedComposerContribution(customization, popup.id),
          popup,
        }))
      : [],
  );
}

export type ResolvedComposerPopup = ReturnType<
  typeof resolveComposerPopups
>[number];
