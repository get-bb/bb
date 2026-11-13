import { PostHog } from "posthog-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { evaluateLocalFlag, parseFlagDefinitions } from "./local-flags";

const ALL = { properties: [], rollout_percentage: 100 };

const FLAGS = [
  {
    key: "split-50-50",
    active: true,
    filters: {
      groups: [ALL],
      multivariate: {
        variants: [
          { key: "control", rollout_percentage: 50 },
          { key: "test", rollout_percentage: 50 },
        ],
      },
    },
  },
  {
    key: "split-three-way",
    active: true,
    filters: {
      groups: [ALL],
      multivariate: {
        variants: [
          { key: "control", rollout_percentage: 34 },
          { key: "a", rollout_percentage: 33 },
          { key: "b", rollout_percentage: 33 },
        ],
      },
    },
  },
  {
    key: "partial-rollout",
    active: true,
    filters: {
      groups: [{ properties: [], rollout_percentage: 40 }],
      multivariate: {
        variants: [
          { key: "control", rollout_percentage: 20 },
          { key: "test", rollout_percentage: 80 },
        ],
      },
    },
  },
  {
    key: "override-then-split",
    active: true,
    filters: {
      groups: [
        { properties: [], rollout_percentage: 10, variant: "test" },
        { properties: [], rollout_percentage: 60 },
      ],
      multivariate: {
        variants: [
          { key: "control", rollout_percentage: 50 },
          { key: "test", rollout_percentage: 50 },
        ],
      },
    },
  },
  {
    key: "inactive",
    active: false,
    filters: {
      groups: [ALL],
      multivariate: {
        variants: [
          { key: "control", rollout_percentage: 50 },
          { key: "test", rollout_percentage: 50 },
        ],
      },
    },
  },
];

const IDS = Array.from({ length: 300 }, (_, index) =>
  index % 2 === 0
    ? `visitor-${index}`
    : `0199f0a1-2b3c-7d4e-8f90-${index.toString(16).padStart(12, "0")}`,
);

describe("local flag evaluation against posthog-node", () => {
  let client: PostHog;

  beforeAll(async () => {
    client = new PostHog("phc_test", {
      host: "https://flags.test",
      personalApiKey: "phs_test",
      featureFlagsPollingInterval: 60 * 60 * 1000,
      flushAt: 1000,
      fetch: async (url) => {
        if (!url.includes("/flags/definitions")) {
          throw new Error(`unexpected request to ${url}`);
        }
        return new Response(
          JSON.stringify({ flags: FLAGS, group_type_mapping: {}, cohorts: {} }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    expect(await client.waitForLocalEvaluationReady(5000)).toBe(true);
  });

  afterAll(async () => {
    await client.shutdown(0);
  });

  it.each(FLAGS.map((flag) => flag.key))(
    "assigns the same variants as posthog-node for %s",
    async (key) => {
      const definitions = parseFlagDefinitions({ flags: FLAGS });
      if (definitions === null) {
        throw new Error("definitions did not parse");
      }
      for (const id of IDS) {
        const expected = await client.getFeatureFlag(key, id, {
          onlyEvaluateLocally: true,
          sendFeatureFlagEvents: false,
        });
        const actual = await evaluateLocalFlag(definitions, key, id);
        expect(actual.kind).toBe("assigned");
        expect([
          id,
          actual.kind === "assigned" ? (actual.variant ?? false) : null,
        ]).toEqual([id, expected ?? false]);
      }
    },
  );
});
