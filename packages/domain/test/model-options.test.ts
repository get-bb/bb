import { describe, expect, it } from "vitest";
import {
  defaultModelOptionValues,
  findModelForOptionValues,
  modelAcceptsOptionValue,
  modelOptionConflictReason,
  reconcileModelOptionValues,
  visibleModelOptions,
} from "../src/model-options.js";
import { resolvedThreadExecutionOptionsSchema } from "../src/shared-types.js";

const provider = {
  experimental_modelOptions: [
    {
      id: "daybreak",
      label: "Daybreak",
      values: [
        {
          id: "off",
          label: "Off",
          modelUnavailableReason: "Turn on Daybreak to use this model",
        },
        {
          id: "on",
          label: "On",
          modelUnavailableReason: "Turn off Daybreak to use this model",
        },
      ],
      defaultValue: "off",
    },
  ],
};

const astra = {
  model: "gpt-6-astra",
  isDefault: true,
  experimental_supportedModelOptions: { daybreak: ["off"] },
};
const sol = {
  model: "gpt-6-sol",
  isDefault: false,
  experimental_supportedModelOptions: { daybreak: ["off", "on"] },
};
const daybreakOnly = {
  model: "gpt-daybreak-blue-latest",
  isDefault: false,
  experimental_supportedModelOptions: { daybreak: ["on"] },
};
const unrestricted: {
  model: string;
  isDefault: boolean;
  experimental_supportedModelOptions?: Record<string, string[]>;
} = { model: "gpt-legacy", isDefault: false };

describe("model option values", () => {
  it("fills declared defaults and drops undeclared ids and values", () => {
    expect(defaultModelOptionValues(provider)).toEqual({ daybreak: "off" });
    expect(
      reconcileModelOptionValues(provider, { daybreak: "on", other: "x" }),
    ).toEqual({ daybreak: "on" });
    expect(reconcileModelOptionValues(provider, { daybreak: "maybe" })).toEqual(
      { daybreak: "off" },
    );
    expect(reconcileModelOptionValues(undefined, { daybreak: "on" })).toEqual(
      {},
    );
  });

  it("treats a model without a list as accepting every value", () => {
    expect(modelAcceptsOptionValue(unrestricted, "daybreak", "on")).toBe(true);
    expect(modelAcceptsOptionValue(astra, "daybreak", "on")).toBe(false);
  });
});

describe("visibleModelOptions", () => {
  it("shows an option only when some model explicitly accepts a non-default value", () => {
    expect(visibleModelOptions({ provider, models: [astra, sol] })).toEqual(
      provider.experimental_modelOptions,
    );
    expect(visibleModelOptions({ provider, models: [astra] })).toEqual([]);
    expect(visibleModelOptions({ provider, models: [unrestricted] })).toEqual(
      [],
    );
  });
});

describe("modelOptionConflictReason", () => {
  it("returns the selected value's reason for a model that rejects it", () => {
    expect(
      modelOptionConflictReason({
        provider,
        model: astra,
        values: { daybreak: "on" },
      }),
    ).toBe("Turn off Daybreak to use this model");
    expect(
      modelOptionConflictReason({
        provider,
        model: daybreakOnly,
        values: { daybreak: "off" },
      }),
    ).toBe("Turn on Daybreak to use this model");
    expect(
      modelOptionConflictReason({
        provider,
        model: sol,
        values: { daybreak: "on" },
      }),
    ).toBeNull();
  });

  it("checks the default value when a value is missing", () => {
    expect(
      modelOptionConflictReason({ provider, model: daybreakOnly, values: {} }),
    ).toBe("Turn on Daybreak to use this model");
  });
});

describe("findModelForOptionValues", () => {
  const models = [astra, sol, daybreakOnly];

  it("keeps the current model when it accepts the values", () => {
    expect(
      findModelForOptionValues({
        provider,
        models,
        currentModel: "gpt-6-sol",
        values: { daybreak: "on" },
      })?.model,
    ).toBe("gpt-6-sol");
  });

  it("moves an incompatible model to the default, then the first compatible model", () => {
    expect(
      findModelForOptionValues({
        provider,
        models,
        currentModel: "gpt-6-astra",
        values: { daybreak: "on" },
      })?.model,
    ).toBe("gpt-6-sol");
    expect(
      findModelForOptionValues({
        provider,
        models,
        currentModel: "gpt-daybreak-blue-latest",
        values: { daybreak: "off" },
      })?.model,
    ).toBe("gpt-6-astra");
  });

  it("returns null when no model accepts the values", () => {
    expect(
      findModelForOptionValues({
        provider,
        models: [astra],
        currentModel: "gpt-6-astra",
        values: { daybreak: "on" },
      }),
    ).toBeNull();
  });
});

describe("resolved execution options", () => {
  it("parses records written before model options existed", () => {
    expect(
      resolvedThreadExecutionOptionsSchema.parse({
        model: "gpt-6-sol",
        serviceTier: "default",
        reasoningLevel: "medium",
        permissionMode: "auto",
        source: "client/turn/start",
      }).modelOptions,
    ).toEqual({});
  });
});
