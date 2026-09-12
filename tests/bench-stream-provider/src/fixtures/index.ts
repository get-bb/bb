import { apiDesign } from "./api-design.js";
import { dataAnalysis } from "./data-analysis.js";
import { incidentWriteup } from "./incident-writeup.js";
import { longResponse } from "./long-response.js";
import { pathological } from "./pathological.js";
import { refactorPlan } from "./refactor-plan.js";

export const FIXTURE_NAMES = [
  "long-response",
  "incident-writeup",
  "refactor-plan",
  "api-design",
  "data-analysis",
  "pathological",
] as const;

export type FixtureName = (typeof FIXTURE_NAMES)[number];

const FIXTURES: Readonly<Record<FixtureName, string>> = {
  "long-response": longResponse,
  "incident-writeup": incidentWriteup,
  "refactor-plan": refactorPlan,
  "api-design": apiDesign,
  "data-analysis": dataAnalysis,
  pathological,
};

function isFixtureName(name: string): name is FixtureName {
  return FIXTURE_NAMES.some((candidate) => candidate === name);
}

export function listFixtureNames(): FixtureName[] {
  return [...FIXTURE_NAMES];
}

export function getFixture(name: string): string {
  if (!isFixtureName(name)) {
    throw new Error(
      `Unknown bench fixture "${name}"; known fixtures: ${FIXTURE_NAMES.join(", ")}`,
    );
  }
  return FIXTURES[name];
}

export function streamDocumentText(name: string, repeat: number): string {
  if (!Number.isInteger(repeat) || repeat < 1) {
    throw new Error(`repeat must be a positive integer, got ${repeat}`);
  }
  const fixture = getFixture(name);
  return Array.from({ length: repeat }, () => fixture).join("\n\n");
}
