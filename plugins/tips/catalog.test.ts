import { describe, expect, it } from "vitest";
import {
  CATALOG_REVIEWED_THROUGH,
  TIP_BODY_MAX,
  TIP_CATALOG,
  TIP_TITLE_MAX,
  renderTip,
  type TipSignals,
} from "./catalog.js";
import { TIP_IDS, tipActionSchema, tipViewSchema } from "./contract.js";
import { compareVersions } from "./engine.js";
import { ILLUSTRATION_IDS } from "./illustrations.js";

const VERSION = /^\d+\.\d+\.\d+$/u;

function signals(overrides: Partial<TipSignals> = {}): TipSignals {
  return {
    client: { surface: "desktop", os: "macos" },
    projectId: null,
    serverPlatform: "darwin",
    appVersion: "1.1.0",
    firstSeenVersion: "1.0.0",
    daysSinceFirstSeen: 7,
    threadCount: 60,
    availableProviderCount: 3,
    installedPlugins: {},
    hasFinishedThread: true,
    finishedThreadCount: 10,
    hasChildThread: false,
    hasAutomationThread: false,
    projectHasChildThread: false,
    projectHasAutomationThread: false,
    waitingThreadCount: 3,
    rateLimited: true,
    recentlyRateLimited: true,
    queuedFollowUp: false,
    usedMobileApp: false,
    ...overrides,
  };
}

const FIXTURES: readonly TipSignals[] = [
  signals(),
  signals({ availableProviderCount: 1 }),
  signals({
    client: { surface: "desktop", os: "macos", notificationNudge: true },
    installedPlugins: { "push-notifications": true },
  }),
  signals({
    installedPlugins: {
      "account-pool": false,
      automations: true,
      "bb--provider-usage": true,
    },
  }),
];

describe("tip catalog", () => {
  it("gives every tip a unique id from TIP_IDS, and every id a tip", () => {
    const ids = TIP_CATALOG.map((definition) => definition.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...TIP_IDS].sort());
  });

  it("keeps every title and body short, plain, and one sentence", () => {
    for (const definition of TIP_CATALOG) {
      const view = renderTip(definition, signals());
      expect(tipViewSchema.safeParse(view).success, definition.id).toBe(true);
      expect(view.title.length, definition.id).toBeLessThanOrEqual(
        TIP_TITLE_MAX,
      );
      expect(view.body.length, definition.id).toBeLessThanOrEqual(TIP_BODY_MAX);
      expect(view.body.match(/[.!?](\s|$)/gu)?.length, definition.id).toBe(1);
      expect(`${view.title} ${view.body}`, definition.id).not.toMatch(
        /\{\w+\}/u,
      );
    }
  });

  it("describes outcomes instead of naming child threads in titles and bodies", () => {
    for (const definition of TIP_CATALOG) {
      expect(
        `${definition.title} ${definition.body}`,
        definition.id,
      ).not.toMatch(/child thread/iu);
    }
  });

  it("draws every tip with an illustration that exists", () => {
    for (const definition of TIP_CATALOG) {
      expect(ILLUSTRATION_IDS, definition.id).toContain(
        definition.illustration,
      );
    }
  });

  it("gives every tip a valid action of a known type", () => {
    for (const definition of TIP_CATALOG) {
      expect(
        tipActionSchema.safeParse(definition.action).success,
        definition.id,
      ).toBe(true);
    }
  });

  it("records a source and versions, and holds no expired tips", () => {
    for (const definition of TIP_CATALOG) {
      expect(definition.source.ref.length, definition.id).toBeGreaterThan(0);
      expect(definition.addedAt, definition.id).toMatch(VERSION);
      expect(definition.reviewedAt, definition.id).toMatch(VERSION);
      expect(
        compareVersions(definition.reviewedAt, CATALOG_REVIEWED_THROUGH),
        definition.id,
      ).toBeLessThanOrEqual(0);
      if (definition.expiresAt !== undefined) {
        expect(definition.expiresAt, definition.id).toMatch(VERSION);
        expect(
          compareVersions(definition.expiresAt, CATALOG_REVIEWED_THROUGH),
          `${definition.id} expired`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("walks people through multi-step setup with a conditional interactive answer", () => {
    for (const id of ["phone", "remote-access", "build-plugin", "add-agent"]) {
      const definition = TIP_CATALOG.find((candidate) => candidate.id === id);
      const action = definition?.action;
      expect(action?.kind, id).toBe("prompt");
      if (action?.kind !== "prompt") continue;
      expect(action.prompt, id).toMatch(
        /^Walk me through .+ in this bb, one step at a time/u,
      );
      expect(action.prompt, id).toContain(
        "If the interactive_answer tool is available, show the steps as an interactive answer; otherwise reply with plain numbered steps.",
      );
    }
    for (const id of ["child-threads", "another-agent"]) {
      const action = TIP_CATALOG.find(
        (candidate) => candidate.id === id,
      )?.action;
      expect(
        action?.kind === "prompt" && action.prompt.endsWith("Task: "),
        id,
      ).toBe(true);
    }
  });

  it("keeps the agreed tiers", () => {
    const tierOf = (id: string) =>
      TIP_CATALOG.find((definition) => definition.id === id)?.tier;
    for (const id of [
      "child-threads",
      "phone",
      "another-agent",
      "build-plugin",
    ]) {
      expect(tierOf(id), id).toBe(1);
    }
    for (const id of ["remote-access", "bb-cli", "add-agent"]) {
      expect(tierOf(id), id).toBe(2);
    }
    expect(tierOf("queue-or-steer")).toBe(3);
    expect(tierOf("browse-plugins")).toBe(3);
    expect(tierOf("notifications")).toBe("unranked");
    const unranked = TIP_CATALOG.filter(
      (definition) => definition.tier === "unranked",
    ).sort((left, right) => right.priority - left.priority);
    expect(unranked[0]?.id).toBe("automations");
  });

  it("has no dead tips: every tip that is not held can show for someone", () => {
    for (const definition of TIP_CATALOG) {
      if (definition.held) continue;
      expect(
        FIXTURES.some((fixture) => definition.eligible(fixture)),
        definition.id,
      ).toBe(true);
    }
  });
});
