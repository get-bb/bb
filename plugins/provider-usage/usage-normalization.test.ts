import { expect, it } from "vitest";
import {
  normalizeUsageMeasurement,
  selectUsageResources,
} from "./usage-normalization.js";
import { usageMeasurementSchema } from "./usage-source-contract.js";

it("merges only matching provider-issued identities, preferring shared observations without summing limits", () => {
  const host = {
    id: "machine",
    providerId: "custom",
    accountKey: "issuer:account:1",
    scope: { kind: "host" as const },
    percent: 40,
  };
  const shared = {
    ...host,
    id: "pool",
    scope: { kind: "shared" as const },
    percent: 50,
  };
  const unknown = { ...host, id: "unknown", accountKey: null };
  const other = { ...host, id: "other", accountKey: "issuer:account:2" };
  const differentProvider = { ...shared, providerId: "different" };
  expect(
    selectUsageResources(
      [
        host,
        shared,
        unknown,
        { ...unknown, id: "unknown2" },
        other,
        differentProvider,
      ],
      (resource) => resource,
    ),
  ).toEqual([
    shared,
    unknown,
    { ...unknown, id: "unknown2" },
    other,
    differentProvider,
  ]);
  expect(selectUsageResources([host], (resource) => resource)).toEqual([host]);
});

it("normalizes structured plans and windows while retaining custom provider labels", () => {
  const raw = usageMeasurementSchema.parse({
    observedAt: 123,
    usage: {
      status: "ok",
      accountEmail: null,
      planLabel: "max",
      plan: { id: "max", multiplier: 20 },
      windows: [
        {
          id: "weekly",
          kind: "weekly",
          label: "168 hour window",
          model: null,
          usedPercent: 50,
          resetsAt: null,
          cost: null,
        },
        {
          id: "fable",
          kind: "weekly",
          label: "Fable",
          model: "fable",
          usedPercent: 25,
          resetsAt: null,
          cost: null,
        },
        {
          id: "custom",
          label: "Monthly tokens",
          model: null,
          usedPercent: 5,
          resetsAt: null,
          cost: null,
        },
      ],
    },
  });
  expect(normalizeUsageMeasurement(raw)).toMatchObject({
    accountKey: null,
    usage: {
      planLabel: "Max (20x)",
      windows: [
        { label: "Weekly limit" },
        { label: "Weekly · Fable" },
        { label: "Monthly tokens" },
      ],
    },
  });
});
