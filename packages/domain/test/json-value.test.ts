import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  jsonValueSchema,
  parseJsonValue,
  tryParseJsonValue,
  type JsonValue,
} from "../src/json-value.js";

const legacyJsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(legacyJsonValueSchema),
    z.record(z.string(), legacyJsonValueSchema),
  ]),
);

function legacySafeParse(value: unknown): JsonValue | undefined {
  return legacyJsonValueSchema.safeParse(value).data;
}

function legacyVerdict(value: unknown): boolean {
  return legacyJsonValueSchema.safeParse(value).success;
}

function expectSameJson(actual: unknown, expected: unknown): void {
  expect(actual).toEqual(expected);
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
}

function thrownMessage(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error);
  }
  return "did not throw";
}

class Point {
  x = 1;
}

function nullPrototype(entries: Record<string, unknown>): object {
  return Object.assign(Object.create(null), entries);
}

function withHiddenKeys(): object {
  const value: Record<string, unknown> = { visible: 1 };
  Object.defineProperty(value, "hidden", { value: NaN, enumerable: false });
  return value;
}

function withSymbolKey(enumerable: boolean): object {
  const value: Record<string | symbol, unknown> = { a: 1 };
  Object.defineProperty(value, Symbol("tag"), { value: 1, enumerable });
  return value;
}

function withOwnProto(inner: unknown): object {
  const value = JSON.parse('{"a":1}');
  Object.defineProperty(value, "__proto__", {
    value: inner,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  return value;
}

function withGetter(read: () => unknown): object {
  return Object.defineProperty({}, "g", { get: read, enumerable: true });
}

function sparse(): unknown[] {
  const value = [1, 2, 3];
  delete value[1];
  return value;
}

function arrayWithExtraProperty(): unknown[] {
  const value: unknown[] & { extra?: number } = [1, 2];
  value.extra = NaN;
  return value;
}

class TaggedArray extends Array<unknown> {}

const edgeCases: Array<[string, () => unknown]> = [
  ["string", () => "x"],
  ["empty string", () => ""],
  ["integer", () => 3],
  ["float", () => 1.5],
  ["negative zero", () => -0],
  ["max safe integer", () => Number.MAX_SAFE_INTEGER],
  ["max value", () => Number.MAX_VALUE],
  ["NaN", () => NaN],
  ["Infinity", () => Infinity],
  ["-Infinity", () => -Infinity],
  ["true", () => true],
  ["null", () => null],
  ["undefined", () => undefined],
  ["bigint", () => 1n],
  ["symbol", () => Symbol("s")],
  ["function", () => () => 1],
  ["Date", () => new Date(0)],
  ["Map", () => new Map()],
  ["Set", () => new Set()],
  ["RegExp", () => /x/u],
  ["Uint8Array", () => new Uint8Array(2)],
  ["class instance", () => new Point()],
  ["String object", () => new String("x")],
  ["Number object", () => new Number(1)],
  ["empty array", () => []],
  ["nested array", () => [1, [2, [3, null]], "x"]],
  ["array with undefined member", () => [1, undefined]],
  ["array with NaN member", () => [1, NaN]],
  ["sparse array", sparse],
  ["array with extra property", arrayWithExtraProperty],
  ["array subclass", () => TaggedArray.from([1, "a"])],
  ["empty object", () => ({})],
  ["nested object", () => ({ a: { b: [1, { c: null }] } })],
  ["object with undefined member", () => ({ a: undefined })],
  ["object with function member", () => ({ a: () => 1 })],
  ["object with Date member", () => ({ a: new Date(0) })],
  ["object with Map member", () => ({ a: new Map() })],
  ["null-prototype object", () => nullPrototype({ a: 1, b: [2] })],
  ["null-prototype object with bad member", () => nullPrototype({ a: NaN })],
  ["object inheriting from a plain object", () => Object.create({ a: 1 })],
  [
    "object inheriting from null-prototype object",
    () => Object.create(nullPrototype({ a: 1 })),
  ],
  ["object with own constructor string", () => ({ constructor: "x" })],
  ["object with own constructor function", () => ({ constructor() {} })],
  ["object with own constructor undefined", () => ({ constructor: undefined })],
  ["object with own constructor Object", () => ({ constructor: Object })],
  ["object with own hasOwnProperty string", () => ({ hasOwnProperty: "x" })],
  ["object with toString key", () => ({ toString: 1, valueOf: 2 })],
  ["object with own __proto__ valid value", () => withOwnProto({ a: 1 })],
  ["object with own __proto__ invalid value", () => withOwnProto(NaN)],
  ["object with non-enumerable bad key", withHiddenKeys],
  ["object with enumerable symbol key", () => withSymbolKey(true)],
  ["object with non-enumerable symbol key", () => withSymbolKey(false)],
  ["object with getter", () => withGetter(() => 1)],
  ["object with bad getter", () => withGetter(() => NaN)],
  [
    "shared references",
    () => {
      const shared = { a: [1] };
      return { x: shared, y: shared, z: [shared, shared] };
    },
  ],
  ["object with numeric keys", () => ({ 2: "b", 1: "a", z: 0 })],
];

describe("parseJsonValue / tryParseJsonValue against the legacy schema", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(edgeCases)(
    "gives the same verdict, copy and error for %s",
    (_name, make) => {
      const legacy = legacyJsonValueSchema.safeParse(make());
      const parsed = tryParseJsonValue(make());
      expect(parsed !== undefined).toBe(legacy.success);
      if (legacy.success) {
        expectSameJson(parsed, legacy.data);
        expectSameJson(parseJsonValue(make()), legacy.data);
      } else {
        expect(thrownMessage(() => parseJsonValue(make()))).toBe(
          thrownMessage(() => legacyJsonValueSchema.parse(make())),
        );
      }
    },
  );

  it("pins the verdicts the schema gives to the tricky cases", () => {
    const verdict = (name: string) => {
      const entry = edgeCases.find(([label]) => label === name);
      if (entry === undefined) throw new Error(name);
      return tryParseJsonValue(entry[1]()) !== undefined;
    };
    expect(
      Object.fromEntries(
        [
          "negative zero",
          "NaN",
          "Infinity",
          "undefined",
          "bigint",
          "Date",
          "Map",
          "class instance",
          "String object",
          "array with undefined member",
          "sparse array",
          "array with extra property",
          "array subclass",
          "object with undefined member",
          "null-prototype object",
          "object inheriting from a plain object",
          "object with own constructor string",
          "object with own constructor function",
          "object with own constructor undefined",
          "object with own constructor Object",
          "object with own __proto__ valid value",
          "object with own __proto__ invalid value",
          "object with non-enumerable bad key",
          "object with enumerable symbol key",
          "object with non-enumerable symbol key",
          "object with getter",
          "object with bad getter",
          "shared references",
        ].map((name) => [name, verdict(name)]),
      ),
    ).toEqual({
      "negative zero": true,
      NaN: false,
      Infinity: false,
      undefined: false,
      bigint: false,
      Date: false,
      Map: false,
      "class instance": false,
      "String object": false,
      "array with undefined member": false,
      "sparse array": false,
      "array with extra property": true,
      "array subclass": true,
      "object with undefined member": false,
      "null-prototype object": true,
      "object inheriting from a plain object": true,
      "object with own constructor string": true,
      "object with own constructor function": false,
      "object with own constructor undefined": false,
      "object with own constructor Object": false,
      "object with own __proto__ valid value": true,
      "object with own __proto__ invalid value": true,
      "object with non-enumerable bad key": true,
      "object with enumerable symbol key": false,
      "object with non-enumerable symbol key": true,
      "object with getter": true,
      "object with bad getter": false,
      "shared references": true,
    });
  });

  it("keeps -0 and drops array extras, own __proto__ keys and hidden keys like the schema", () => {
    expect(Object.is(parseJsonValue(-0), -0)).toBe(true);
    expect(parseJsonValue(arrayWithExtraProperty())).toStrictEqual([1, 2]);
    expect(
      Object.hasOwn(
        parseJsonValue(withOwnProto({ a: 1 })) as object,
        "__proto__",
      ),
    ).toBe(false);
    expect(parseJsonValue(withHiddenKeys())).toStrictEqual({ visible: 1 });
    expect(Object.getPrototypeOf(parseJsonValue(nullPrototype({ a: 1 })))).toBe(
      Object.prototype,
    );
  });

  it("reads each getter once, as the schema does", () => {
    const legacyReads = vi.fn(() => 1);
    const newReads = vi.fn(() => 1);
    legacySafeParse(withGetter(legacyReads));
    tryParseJsonValue(withGetter(newReads));
    expect(newReads).toHaveBeenCalledTimes(legacyReads.mock.calls.length);
  });

  it("returns fresh arrays and objects, never the input", () => {
    const input = { list: [1, { deep: true }], text: "x" };
    const parsed = parseJsonValue(input) as typeof input;
    expect(parsed).toStrictEqual(input);
    expect(parsed).not.toBe(input);
    expect(parsed.list).not.toBe(input.list);
    expect(parsed.list[1]).not.toBe(input.list[1]);
  });

  it("accepts a cycle like the schema and returns a cyclic copy", () => {
    const make = () => {
      const cyclic: { n: number; self?: unknown; list: unknown[] } = {
        n: 1,
        list: [],
      };
      cyclic.self = cyclic;
      cyclic.list.push(cyclic.list);
      return cyclic;
    };
    const legacy = legacyJsonValueSchema.safeParse(make());
    expect(legacy.success).toBe(true);
    for (const parsed of [tryParseJsonValue(make()), parseJsonValue(make())]) {
      const copy = parsed as ReturnType<typeof make>;
      expect(copy.n).toBe(1);
      expect(copy.self).toBe(copy);
      expect(copy.list[0]).toBe(copy.list);
    }
    const input = make();
    expect(parseJsonValue(input)).not.toBe(input);
  });

  it("rejects a cycle that holds a bad value like the schema", () => {
    const make = () => {
      const cyclic: { bad: number; self?: unknown } = { bad: NaN };
      cyclic.self = cyclic;
      return cyclic;
    };
    expect(legacyVerdict(make())).toBe(false);
    expect(tryParseJsonValue(make())).toBeUndefined();
    expect(thrownMessage(() => parseJsonValue(make()))).toBe(
      thrownMessage(() => legacyJsonValueSchema.parse(make())),
    );
  });

  it("keeps shared references shared like the schema", () => {
    const shared = { a: [1] };
    const legacy = legacySafeParse({ x: shared, y: shared }) as {
      x: unknown;
      y: unknown;
    };
    const parsed = parseJsonValue({ x: shared, y: shared }) as {
      x: unknown;
      y: unknown;
    };
    expect(parsed.x === parsed.y).toBe(legacy.x === legacy.y);
  });

  it("matches the schema on seeded random JSON and non-JSON values", () => {
    let seed = 0x9e3779b9;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T>(items: readonly T[]): T =>
      items[Math.floor(random() * items.length)] as T;
    const keys = ["a", "b", "id", "constructor", "toString", "__proto__", "0"];
    const leaves: Array<() => unknown> = [
      () => "text",
      () => "",
      () => Math.floor(random() * 1000) - 500,
      () => random() * 1e6,
      () => -0,
      () => true,
      () => false,
      () => null,
      () => NaN,
      () => Infinity,
      () => -Infinity,
      () => undefined,
      () => 7n,
      () => Symbol("s"),
      () => () => 1,
      () => new Date(1),
      () => new Map(),
      () => new Point(),
      () => nullPrototype({ n: 1 }),
      sparse,
      arrayWithExtraProperty,
      () => withSymbolKey(random() < 0.5),
      withHiddenKeys,
    ];
    const generate = (depth: number, badRate: number): unknown => {
      const roll = random();
      if (depth === 0 || roll < 0.35) {
        const leaf =
          random() < badRate ? pick(leaves) : pick(leaves.slice(0, 8));
        return leaf();
      }
      if (roll < 0.65) {
        return Array.from({ length: Math.floor(random() * 4) }, () =>
          generate(depth - 1, badRate),
        );
      }
      const out: Record<string, unknown> = {};
      for (let index = 0; index < Math.floor(random() * 4); index++) {
        Object.defineProperty(out, pick(keys), {
          value: generate(depth - 1, badRate),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return out;
    };
    let accepted = 0;
    let rejected = 0;
    for (let index = 0; index < 4000; index++) {
      const badRate = index % 3 === 0 ? 0 : 0.12;
      const seedState = seed;
      const value = generate(4, badRate);
      seed = seedState;
      const twin = generate(4, badRate);
      const legacy = legacyJsonValueSchema.safeParse(value);
      const parsed = tryParseJsonValue(twin);
      expect(parsed !== undefined).toBe(legacy.success);
      if (legacy.success) {
        accepted += 1;
        expectSameJson(parsed, legacy.data);
      } else {
        rejected += 1;
      }
    }
    expect(accepted).toBeGreaterThan(300);
    expect(rejected).toBeGreaterThan(100);
  });

  it("never runs the schema for ordinary JSON and runs it once for anything else", () => {
    const safeParse = vi.spyOn(jsonValueSchema, "safeParse");
    const parse = vi.spyOn(jsonValueSchema, "parse");
    const ordinary = {
      id: 1,
      rows: Array.from({ length: 50 }, (_, index) => ({
        name: `row ${index}`,
        tags: ["a", "b"],
        done: index % 2 === 0,
        parent: null,
        score: index / 3,
      })),
    };
    expectSameJson(tryParseJsonValue(ordinary), ordinary);
    expectSameJson(parseJsonValue(ordinary), ordinary);
    expect(tryParseJsonValue(null)).toBeNull();
    expect(safeParse).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();

    expect(tryParseJsonValue({ ...ordinary, bad: NaN })).toBeUndefined();
    expect(safeParse).toHaveBeenCalledTimes(1);
    expect(() => parseJsonValue({ ...ordinary, bad: NaN })).toThrow();
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("accepts a large response the same as the schema", () => {
    const node = (depth: number): JsonValue =>
      depth === 0
        ? "leaf"
        : {
            id: depth,
            kids: [node(depth - 1), node(depth - 1), node(depth - 1)],
            flag: depth % 2 === 0,
            none: null,
          };
    const tree = node(7);
    const legacy = legacySafeParse(tree);
    expectSameJson(tryParseJsonValue(tree), legacy);
    expect(legacyVerdict(tree)).toBe(true);
  });
});
