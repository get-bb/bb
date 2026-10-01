import { describe, expect, it } from "vitest";
import {
  createOrderKeyAfter,
  createOrderKeyBetween,
} from "../../src/data/order-keys.js";

interface AssertKeyBetweenArgs {
  key: string;
  nextKey: string | null;
  previousKey: string | null;
}

function expectKeyBetween({
  key,
  nextKey,
  previousKey,
}: AssertKeyBetweenArgs): void {
  if (previousKey !== null) {
    expect(key > previousKey).toBe(true);
  }
  if (nextKey !== null) {
    expect(key < nextKey).toBe(true);
  }
}

function sortKeys(keys: readonly string[]): string[] {
  return [...keys].sort();
}

describe("order keys", () => {
  it("creates keys before, between, and after existing generated keys", () => {
    const firstKey = createOrderKeyBetween({
      previousKey: null,
      nextKey: null,
    });
    const secondKey = createOrderKeyAfter({ previousKey: firstKey });

    const frontKey = createOrderKeyBetween({
      previousKey: null,
      nextKey: firstKey,
    });
    const middleKey = createOrderKeyBetween({
      previousKey: firstKey,
      nextKey: secondKey,
    });
    const endKey = createOrderKeyAfter({ previousKey: secondKey });

    expectKeyBetween({
      key: frontKey,
      previousKey: null,
      nextKey: firstKey,
    });
    expectKeyBetween({
      key: middleKey,
      previousKey: firstKey,
      nextKey: secondKey,
    });
    expectKeyBetween({
      key: endKey,
      previousKey: secondKey,
      nextKey: null,
    });
    expect(sortKeys([frontKey, firstKey, middleKey, secondKey, endKey])).toEqual(
      [frontKey, firstKey, middleKey, secondKey, endKey],
    );
  });

  it("creates dense front-insertion keys before zero-padded migrated keys", () => {
    const migratedFirstKey = "0000000000000001";
    const frontKey = createOrderKeyBetween({
      previousKey: null,
      nextKey: migratedFirstKey,
    });

    expect(frontKey).toBe("0000000000000000U");
    expectKeyBetween({
      key: frontKey,
      previousKey: null,
      nextKey: migratedFirstKey,
    });
  });

  it("creates dense keys between adjacent zero-padded migrated keys", () => {
    const previousKey = "0000000000000009";
    const nextKey = "0000000000000010";
    const middleKey = createOrderKeyBetween({ previousKey, nextKey });

    expectKeyBetween({ key: middleKey, previousKey, nextKey });
  });

  it("rejects invalid keys and inverted boundaries", () => {
    expect(() =>
      createOrderKeyBetween({
        previousKey: "",
        nextKey: null,
      }),
    ).toThrow("Order key cannot be empty");
    expect(() =>
      createOrderKeyBetween({
        previousKey: "U!",
        nextKey: null,
      }),
    ).toThrow("Invalid order key digit: !");
    expect(() =>
      createOrderKeyBetween({
        previousKey: "b",
        nextKey: "U",
      }),
    ).toThrow("Previous order key must sort before next order key");
  });

  it("rejects boundary pairs with no representable key between them", () => {
    expect(() =>
      createOrderKeyBetween({
        previousKey: null,
        nextKey: "0",
      }),
    ).toThrow("Generated order key must sort before next order key");
    expect(() =>
      createOrderKeyBetween({
        previousKey: "1",
        nextKey: "10",
      }),
    ).toThrow("Generated order key must sort before next order key");
  });
});
