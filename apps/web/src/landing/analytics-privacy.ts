import { CLICK_ID_PARAM_NAMES } from "./site";

export function withoutAdvertisingIds(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (
      CLICK_ID_PARAM_NAMES.some(
        (name) => key === name || key === `$initial_${name}`,
      )
    )
      continue;
    if (typeof value === "string" && /^https?:\/\//.test(value)) {
      try {
        const url = new URL(value);
        for (const name of CLICK_ID_PARAM_NAMES) url.searchParams.delete(name);
        clean[key] = url.href;
      } catch {
        clean[key] = value;
      }
    } else if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      clean[key] = withoutAdvertisingIds(
        Object.fromEntries(Object.entries(value)),
      );
    } else {
      clean[key] = value;
    }
  }
  return clean;
}
