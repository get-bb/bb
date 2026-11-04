import type { PluginAppOnDemandSurface } from "@bb/domain";

export const ON_DEMAND_SURFACE_BY_SLOT: Readonly<
  Record<string, PluginAppOnDemandSurface>
> = {
  settingsSection: "settings-section",
  experimental_environmentProviderInputs: "environment-provider-inputs",
  experimental_machineProviderInputs: "machine-provider-inputs",
};

export const EAGER_PLUGIN_APP_MEMBERS: readonly string[] = [
  "commands",
  "composer",
  "contentScripts",
  "experimental_icons",
  "experimental_sidebarFooter",
];

const IDENTIFIER_CHAR = /[\w$]/u;
const MEMBER_PRECEDERS = new Set([".", "{", ",", '"', "'", "`"]);

function wordPattern(word: string): RegExp {
  return new RegExp(`(?<![\\w$])${word}(?![\\w$])`, "gu");
}

function skipWhitespace(js: string, index: number): number {
  let next = index;
  while (next < js.length && /\s/u.test(js[next]!)) next += 1;
  return next;
}

function isMemberUse(js: string, index: number): boolean {
  let previous = index - 1;
  while (previous >= 0 && /\s/u.test(js[previous]!)) previous -= 1;
  return previous >= 0 && MEMBER_PRECEDERS.has(js[previous]!);
}

function memberUses(js: string, word: string): number[] {
  return [...js.matchAll(wordPattern(word))]
    .map((match) => match.index)
    .filter((index) => isMemberUse(js, index));
}

function slotCallAfter(js: string, slotsEnd: number): string | null {
  let index = skipWhitespace(js, slotsEnd);
  if (js[index] !== ".") return null;
  index = skipWhitespace(js, index + 1);
  const start = index;
  while (index < js.length && IDENTIFIER_CHAR.test(js[index]!)) index += 1;
  if (index === start) return null;
  const name = js.slice(start, index);
  return js[skipWhitespace(js, index)] === "(" ? name : null;
}

export function findOnDemandPluginAppSurfaces(
  js: string,
): PluginAppOnDemandSurface[] {
  if (
    EAGER_PLUGIN_APP_MEMBERS.some((member) => memberUses(js, member).length > 0)
  )
    return [];
  const surfaces = new Set<PluginAppOnDemandSurface>();
  for (const index of memberUses(js, "slots")) {
    const slot = slotCallAfter(js, index + "slots".length);
    const surface =
      slot !== null && Object.hasOwn(ON_DEMAND_SURFACE_BY_SLOT, slot)
        ? ON_DEMAND_SURFACE_BY_SLOT[slot]
        : undefined;
    if (surface === undefined) return [];
    surfaces.add(surface);
  }
  return [...surfaces].sort();
}
