import { describe, expect, it } from "vitest";
import type {
  PluginSettingDescriptor,
  PluginSettingDescriptors,
} from "../backend-contract.js";
import {
  SETTING_KEY_PATTERN,
  registerSettingDescriptors,
  validateSettingsUpdate,
} from "./host-policy.js";

function legacyValidateSettingsUpdate(
  descriptors: PluginSettingDescriptors,
  values: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    const descriptor: PluginSettingDescriptor | undefined = descriptors[key];
    if (!descriptor) {
      errors.push(`unknown setting "${key}"`);
      continue;
    }
    if (value === null) continue;
    if (descriptor.type === "boolean") {
      if (typeof value !== "boolean") {
        errors.push(`setting "${key}" expects a boolean`);
        continue;
      }
      continue;
    }
    if (descriptor.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        errors.push(`setting "${key}" expects a finite number`);
        continue;
      }
      continue;
    }
    if (typeof value !== "string") {
      errors.push(`setting "${key}" expects a string`);
      continue;
    }
    if (descriptor.type === "select" && !descriptor.options.includes(value)) {
      errors.push(
        `setting "${key}" must be one of: ${descriptor.options.join(", ")}`,
      );
      continue;
    }
  }
  return errors;
}

function legacyRegisterSettingDescriptors(
  target: PluginSettingDescriptors,
  added: Record<string, unknown>,
): PluginSettingDescriptors {
  const validated: PluginSettingDescriptors = {};
  for (const [key, raw] of Object.entries(added)) {
    if (!SETTING_KEY_PATTERN.test(key)) {
      throw new Error(
        `invalid setting key "${key}" — use letters, digits, "-" and "_"`,
      );
    }
    if (key in target) {
      throw new Error(`setting "${key}" is already defined`);
    }
    Object.assign(validated, registerSettingDescriptors({}, { [key]: raw }));
  }
  Object.assign(target, validated);
  return validated;
}

function thrownMessage(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "did not throw";
}

function descriptors(): PluginSettingDescriptors {
  return {
    token: { type: "string", label: "Token" },
    mode: {
      type: "select",
      label: "Mode",
      options: ["fast", "slow"],
      default: "fast",
    },
    enabled: { type: "boolean", label: "Enabled" },
    retries: { type: "number", label: "Retries" },
  };
}

const inheritedNames = [
  "constructor",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
  "__defineGetter__",
  "__lookupGetter__",
];

function ownProtoValues(inner: unknown): Record<string, unknown> {
  return JSON.parse(`{"__proto__": ${JSON.stringify(inner)}}`);
}

describe("validateSettingsUpdate against the legacy lookup", () => {
  it("agrees with the legacy lookup on every ordinary key and value", () => {
    const values: unknown[] = [
      "fast",
      "warp",
      "",
      0,
      3,
      1.5,
      Number.NaN,
      Infinity,
      true,
      false,
      null,
      undefined,
      {},
      [],
    ];
    const keys = ["token", "mode", "enabled", "retries", "missing", "Token"];
    for (const key of keys) {
      for (const value of values) {
        expect(validateSettingsUpdate(descriptors(), { [key]: value })).toEqual(
          legacyValidateSettingsUpdate(descriptors(), { [key]: value }),
        );
      }
    }
    expect(
      validateSettingsUpdate(descriptors(), {
        token: "a",
        mode: "slow",
        enabled: true,
        retries: 2,
        other: 1,
      }),
    ).toEqual(['unknown setting "other"']);
  });

  it.each(inheritedNames)(
    "rejects the inherited name %s that the legacy lookup accepted",
    (name) => {
      expect(
        legacyValidateSettingsUpdate(descriptors(), { [name]: "x" }),
      ).toEqual([]);
      expect(validateSettingsUpdate(descriptors(), { [name]: "x" })).toEqual([
        `unknown setting "${name}"`,
      ]);
      expect(validateSettingsUpdate(descriptors(), { [name]: null })).toEqual([
        `unknown setting "${name}"`,
      ]);
      expect(validateSettingsUpdate(descriptors(), { [name]: 5 })).toEqual([
        `unknown setting "${name}"`,
      ]);
    },
  );

  it("rejects an own __proto__ key in a parsed request body", () => {
    expect(
      legacyValidateSettingsUpdate(descriptors(), ownProtoValues("x")),
    ).toEqual([]);
    expect(validateSettingsUpdate(descriptors(), ownProtoValues("x"))).toEqual([
      'unknown setting "__proto__"',
    ]);
    expect(validateSettingsUpdate(descriptors(), ownProtoValues(null))).toEqual(
      ['unknown setting "__proto__"'],
    );
  });

  it("still validates a setting that really is named after an inherited member", () => {
    const own: PluginSettingDescriptors = {
      constructor: { type: "string" as const, label: "Constructor" },
      toString: { type: "boolean" as const, label: "To string" },
    };
    expect(validateSettingsUpdate(own, { constructor: "x" })).toEqual([]);
    expect(validateSettingsUpdate(own, { constructor: 1 })).toEqual([
      'setting "constructor" expects a string',
    ]);
    expect(validateSettingsUpdate(own, { toString: "x" })).toEqual([
      'setting "toString" expects a boolean',
    ]);
    expect(validateSettingsUpdate(own, { valueOf: "x" })).toEqual([
      'unknown setting "valueOf"',
    ]);
  });
});

describe("registerSettingDescriptors against the legacy lookup", () => {
  it("registers ordinary descriptors the same way and rejects redefinition the same way", () => {
    const legacyTarget: PluginSettingDescriptors = {};
    const newTarget: PluginSettingDescriptors = {};
    const added = {
      token: { type: "string", label: "Token" },
      mode: {
        type: "select",
        label: "Mode",
        options: ["a", "b"],
        default: "a",
      },
    };
    expect(registerSettingDescriptors(newTarget, added)).toEqual(
      legacyRegisterSettingDescriptors(legacyTarget, added),
    );
    expect(newTarget).toEqual(legacyTarget);
    expect(
      thrownMessage(() =>
        registerSettingDescriptors(newTarget, {
          token: { type: "string", label: "Again" },
        }),
      ),
    ).toBe(
      thrownMessage(() =>
        legacyRegisterSettingDescriptors(legacyTarget, {
          token: { type: "string", label: "Again" },
        }),
      ),
    );
    expect(
      thrownMessage(() =>
        registerSettingDescriptors(newTarget, { "bad key": {} }),
      ),
    ).toBe(
      thrownMessage(() =>
        legacyRegisterSettingDescriptors(legacyTarget, { "bad key": {} }),
      ),
    );
  });

  it.each(inheritedNames)(
    "lets a plugin define a setting called %s, which the legacy lookup refused",
    (name) => {
      const added = { [name]: { type: "string", label: "Mine" } };
      expect(
        thrownMessage(() => legacyRegisterSettingDescriptors({}, added)),
      ).toBe(`setting "${name}" is already defined`);
      const target: PluginSettingDescriptors = {};
      expect(Object.keys(registerSettingDescriptors(target, added))).toEqual([
        name,
      ]);
      expect(Object.hasOwn(target, name)).toBe(true);
      expect(validateSettingsUpdate(target, { [name]: "x" })).toEqual([]);
      expect(
        thrownMessage(() => registerSettingDescriptors(target, added)),
      ).toBe(`setting "${name}" is already defined`);
    },
  );

  it("refuses the __proto__ key in both versions instead of dropping it silently", () => {
    const added = ownProtoValues({ type: "string", label: "Proto" });
    const legacyTarget: PluginSettingDescriptors = {};
    const newTarget: PluginSettingDescriptors = {};
    expect(
      thrownMessage(() =>
        legacyRegisterSettingDescriptors(legacyTarget, added),
      ),
    ).toBe('setting "__proto__" is already defined');
    expect(
      thrownMessage(() => registerSettingDescriptors(newTarget, added)),
    ).toBe('setting key "__proto__" is reserved');
    expect(Object.keys(newTarget)).toEqual([]);
    expect(Object.getPrototypeOf(newTarget)).toBe(Object.prototype);
  });

  it("does not let an earlier failed define leave half-registered keys behind", () => {
    const target: PluginSettingDescriptors = {};
    expect(() =>
      registerSettingDescriptors(target, {
        good: { type: "string", label: "Good" },
        toString: { type: "number", label: "Bad", default: "x" },
      }),
    ).toThrow(/toString/);
    expect(Object.keys(target)).toEqual([]);
  });
});
