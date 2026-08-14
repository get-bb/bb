import type { JsonValue } from "./types.js";

export function assertJsonValue(
  value: unknown,
  path = "result",
  ancestors = new WeakSet<object>(),
): asserts value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} contains a non-finite number`);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new Error(`${path} contains a cycle`);
    ancestors.add(value);
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) throw new Error(`${path} contains a sparse array`);
      assertJsonValue(value[index], `${path}[${index}]`, ancestors);
    }
    ancestors.delete(value);
    return;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${path} must contain only plain objects and arrays`);
    }
    if (ancestors.has(value)) throw new Error(`${path} contains a cycle`);
    ancestors.add(value);
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new Error(`${path} contains symbol properties`);
    }
    const object = value as Record<string, unknown>;
    for (const key of Object.getOwnPropertyNames(object)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        throw new Error(
          `${path} contains forbidden key ${JSON.stringify(key)}`,
        );
      }
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      if (descriptor === undefined || !("value" in descriptor)) {
        throw new Error(`${path}.${key} must be a data property`);
      }
      if (!descriptor.enumerable) {
        throw new Error(`${path}.${key} must be enumerable`);
      }
      assertJsonValue(descriptor.value, `${path}.${key}`, ancestors);
    }
    ancestors.delete(value);
    return;
  }
  throw new Error(`${path} is not JSON-compatible`);
}

export function toJsonValue(value: unknown, path: string): JsonValue {
  assertJsonValue(value, path);
  return value;
}
