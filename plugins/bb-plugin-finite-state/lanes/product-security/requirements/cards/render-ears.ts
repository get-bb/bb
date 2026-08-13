import type { RequirementYamlV1 } from "./schema.js";

export function normalizeEarsWhitespace(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}
function part(value: string | null | undefined): string | null {
  return value === null || value === undefined
    ? null
    : normalizeEarsWhitespace(value);
}

export function renderEars(ears: RequirementYamlV1["ears"]): string {
  const system = normalizeEarsWhitespace(ears.parts.system);
  const response = normalizeEarsWhitespace(ears.parts.response);
  const trigger = part(ears.parts.trigger);
  const precondition = part(ears.parts.precondition);
  const state = part(ears.parts.state);
  const feature = part(ears.parts.feature);

  switch (ears.pattern) {
    case "ubiquitous":
      return `The ${system} SHALL ${response}`;
    case "event_driven":
      return `WHEN ${trigger ?? ""}, the ${system} SHALL ${response}`;
    case "state_driven":
      return `WHILE ${state ?? ""}, the ${system} SHALL ${response}`;
    case "unwanted_behavior":
      return `IF ${trigger ?? ""}, THEN the ${system} SHALL ${response}`;
    case "optional_feature":
      return `WHERE ${feature ?? ""}, the ${system} SHALL ${response}`;
    case "complex": {
      const clauses = [
        feature ? `WHERE ${feature}` : null,
        precondition ? `IF ${precondition}` : null,
        state ? `WHILE ${state}` : null,
        trigger ? `WHEN ${trigger}` : null,
      ].filter((clause): clause is string => clause !== null);
      return `${clauses.join(", ")}, the ${system} SHALL ${response}`;
    }
  }
}
