import { atom } from "jotai";

interface SectionNameOverride {
  previousName: string;
  name: string;
}

export const sectionNameOverridesAtom = atom<
  ReadonlyMap<string, SectionNameOverride>
>(new Map());

export function resolveSectionName(
  id: string,
  sourceName: string,
  overrides: ReadonlyMap<string, SectionNameOverride>,
): string {
  const override = overrides.get(id);
  return override?.previousName === sourceName ? override.name : sourceName;
}
