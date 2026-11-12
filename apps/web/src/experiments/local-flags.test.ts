import { describe, expect, it } from "vitest";

import {
  evaluateLocalFlag,
  flagHash,
  parseFlagDefinitions,
  type FlagDefinitions,
} from "./local-flags";

const SPLIT = {
  variants: [
    { key: "control", rollout_percentage: 50 },
    { key: "test", rollout_percentage: 50 },
  ],
};

function definitions(...flags: unknown[]): FlagDefinitions {
  const parsed = parseFlagDefinitions({ flags });
  if (parsed === null) {
    throw new Error("definitions did not parse");
  }
  return parsed;
}

function flag(filters: Record<string, unknown>, extra = {}) {
  return { key: "homepage-hero", active: true, filters, ...extra };
}

async function variantsFor(
  defs: FlagDefinitions,
  ids: readonly string[],
): Promise<(string | null | "inconclusive")[]> {
  return Promise.all(
    ids.map(async (id) => {
      const result = await evaluateLocalFlag(defs, "homepage-hero", id);
      return result.kind === "assigned" ? result.variant : "inconclusive";
    }),
  );
}

const IDS = [
  "0199f0a1-2b3c-7d4e-8f90-a1b2c3d4e5f6",
  "visitor-1",
  "visitor-2",
  "visitor-3",
  "visitor-4",
  "visitor-5",
  "visitor-6",
  "visitor-7",
];

describe("local flag evaluation", () => {
  it("hashes like posthog-node", async () => {
    expect(await flagHash("homepage-hero", "visitor-1")).toBe(
      0.06109865864416698,
    );
    expect(await flagHash("homepage-hero", "visitor-1", "variant")).toBe(
      0.697373325650049,
    );
  });

  it("assigns the variants posthog-node assigns for a 50/50 test", async () => {
    const defs = definitions(
      flag({
        groups: [{ properties: [], rollout_percentage: 100 }],
        multivariate: SPLIT,
      }),
    );
    expect(await variantsFor(defs, IDS)).toEqual([
      "control",
      "test",
      "control",
      "test",
      "test",
      "test",
      "control",
      "control",
    ]);
  });

  it("leaves visitors outside the rollout unassigned", async () => {
    const defs = definitions(
      flag({
        groups: [{ properties: [], rollout_percentage: 10 }],
        multivariate: SPLIT,
      }),
    );
    expect(await variantsFor(defs, ["visitor-1", "visitor-2"])).toEqual([
      "test",
      null,
    ]);
  });

  it("uses a condition's variant override and stops at the first match", async () => {
    const defs = definitions(
      flag({
        groups: [
          { properties: [], rollout_percentage: 10, variant: "control" },
          { properties: [], rollout_percentage: 100 },
        ],
        multivariate: SPLIT,
      }),
    );
    expect(await variantsFor(defs, ["visitor-1", "visitor-2"])).toEqual([
      "control",
      "control",
    ]);
  });

  it("assigns nothing for an inactive flag", async () => {
    const defs = definitions(
      flag(
        {
          groups: [{ properties: [], rollout_percentage: 100 }],
          multivariate: SPLIT,
        },
        { active: false },
      ),
    );
    expect(await variantsFor(defs, ["visitor-1"])).toEqual([null]);
  });

  it.each([
    ["a missing flag", []],
    [
      "person property conditions",
      [
        flag({
          groups: [
            {
              properties: [{ key: "email", value: "x", type: "person" }],
              rollout_percentage: 100,
            },
          ],
          multivariate: SPLIT,
        }),
      ],
    ],
    [
      "experience continuity",
      [
        flag(
          {
            groups: [{ properties: [], rollout_percentage: 100 }],
            multivariate: SPLIT,
          },
          { ensure_experience_continuity: true },
        ),
      ],
    ],
    [
      "device_id bucketing",
      [
        flag(
          {
            groups: [{ properties: [], rollout_percentage: 100 }],
            multivariate: SPLIT,
          },
          { bucketing_identifier: "device_id" },
        ),
      ],
    ],
    [
      "group aggregation",
      [
        flag({
          aggregation_group_type_index: 0,
          groups: [{ properties: [], rollout_percentage: 100 }],
          multivariate: SPLIT,
        }),
      ],
    ],
    [
      "a group-targeted condition",
      [
        flag({
          groups: [
            {
              properties: [],
              rollout_percentage: 100,
              aggregation_group_type_index: 0,
            },
          ],
          multivariate: SPLIT,
        }),
      ],
    ],
    [
      "an experiment holdout",
      [
        flag({
          holdout: { id: 7, exclusion_percentage: 15 },
          groups: [{ properties: [], rollout_percentage: 100 }],
          multivariate: SPLIT,
        }),
      ],
    ],
    [
      "early exit",
      [
        flag({
          early_exit: true,
          groups: [{ properties: [], rollout_percentage: 100 }],
          multivariate: SPLIT,
        }),
      ],
    ],
    [
      "early access enrollment",
      [
        flag({
          super_groups: [{ properties: [], rollout_percentage: 100 }],
          groups: [{ properties: [], rollout_percentage: 100 }],
          multivariate: SPLIT,
        }),
      ],
    ],
    [
      "a malformed variant",
      [
        flag({
          groups: [{ properties: [], rollout_percentage: 100 }],
          multivariate: { variants: [{ key: "test" }] },
        }),
      ],
    ],
  ])("leaves %s to the server", async (_name, flags) => {
    expect(await variantsFor(definitions(...flags), ["visitor-1"])).toEqual([
      "inconclusive",
    ]);
  });
});
