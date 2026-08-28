import type { JsonValue } from "./types.js";

type JsonValidationInput = Parameters<typeof JSON.stringify>[0];

export function assertJsonValue(
  value: JsonValidationInput,
  path = "result",
  ancestors = new WeakSet<object>(),
): asserts value is JsonValue {
  const tag = Object.prototype.toString.call(value);
  if (
    value === null ||
    ((tag === "[object String]" || tag === "[object Boolean]") &&
      Object(value) !== value)
  ) {
    return;
  }
  if (tag === "[object Number]" && Object(value) !== value) {
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
  if (value !== null && Object(value) === value) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${path} must contain only plain objects and arrays`);
    }
    if (ancestors.has(value)) throw new Error(`${path} contains a cycle`);
    ancestors.add(value);
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new Error(`${path} contains symbol properties`);
    }
    const object = Object(value);
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

export function toJsonValue(
  value: JsonValidationInput,
  path: string,
): JsonValue {
  assertJsonValue(value, path);
  return value;
}
