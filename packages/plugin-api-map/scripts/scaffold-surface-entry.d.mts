export type FixtureFidelity = "none" | "anchor" | "state" | "flow";
export type FixtureResponsiveStrategy = "scale-together" | "reflow";

export interface SurfaceEntryScaffoldInput {
  id: string | null;
  title: string | null;
  groupId: string | null;
  sourcePaths: string[];
  apiSymbols: string[];
  spatialOwner: boolean;
  transient: boolean;
  outcome: boolean;
  replacement: boolean;
}

export interface SurfaceEntryScaffold {
  schemaVersion: 1;
  surface: {
    id: string;
    title: string;
    summary: string;
    bullets: string[];
    apiSymbols: string[];
  };
  fixture: null | {
    groupId: string;
    fidelity: Exclude<FixtureFidelity, "none">;
    responsiveStrategy: "scale-together";
    requiredStates: string[];
    sources: Array<{ path: string; anchors: string[] }>;
    fixtureClassAnchors: string[];
  };
}

export function classifyFixtureFidelity(
  input: Pick<
    SurfaceEntryScaffoldInput,
    "spatialOwner" | "transient" | "outcome" | "replacement"
  >,
): FixtureFidelity;
export function fixtureResponsiveStrategy(
  input: Pick<SurfaceEntryScaffoldInput, "spatialOwner">,
): FixtureResponsiveStrategy;
export function parseScaffoldArgs(argv: string[]): SurfaceEntryScaffoldInput;
export function buildSurfaceEntryScaffold(
  input: SurfaceEntryScaffoldInput,
): SurfaceEntryScaffold;
export function renderSurfaceEntryScaffold(
  input: SurfaceEntryScaffoldInput,
): string;
