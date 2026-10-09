import { describe, expect, it } from "vitest";
import {
  TIP_CATALOG,
  renderTip,
  type TipDefinition,
  type TipSignals,
} from "./catalog.js";
import {
  UnknownTipError,
  VISIT_DEBOUNCE_MS,
  actOnTip,
  compareVersions,
  createTipsState,
  deriveSignals,
  dismissTip,
  hideTips,
  listTips,
  localDay,
  observeLiveSignals,
  parseTipsState,
  rankEligibleTips,
  resetTips,
  visitFeed,
  type LiveSignals,
  type TipsState,
} from "./engine.js";
import { classifyAudience, isWaitingOnUser } from "./signals.js";

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const START = Date.UTC(2026, 9, 5, 12);

function signals(overrides: Partial<TipSignals> = {}): TipSignals {
  return {
    client: { surface: "web", os: "macos" },
    projectId: null,
    serverPlatform: "darwin",
    appVersion: "1.0.0",
    firstSeenVersion: "1.0.0",
    daysSinceFirstSeen: 0,
    threadCount: 0,
    availableProviderCount: 1,
    installedPlugins: {},
    hasFinishedThread: false,
    finishedThreadCount: 0,
    hasChildThread: false,
    hasAutomationThread: false,
    projectHasChildThread: false,
    projectHasAutomationThread: false,
    waitingThreadCount: 0,
    rateLimited: false,
    recentlyRateLimited: false,
    queuedFollowUp: false,
    usedMobileApp: false,
    ...overrides,
  };
}

function live(overrides: Partial<LiveSignals> = {}): LiveSignals {
  return {
    projectId: null,
    serverPlatform: "darwin",
    appVersion: "1.0.0",
    threadCount: 0,
    finishedThreadCount: 0,
    hasChildThread: false,
    hasAutomationThread: false,
    projectHasChildThread: false,
    projectHasAutomationThread: false,
    waitingThreadCount: 0,
    availableProviderCount: 1,
    installedPlugins: {},
    ...overrides,
  };
}

function testTip(
  id: string,
  overrides: Partial<TipDefinition> = {},
): TipDefinition {
  return {
    id,
    title: `Title ${id}`,
    body: `Body ${id}.`,
    illustration: "child-threads",
    tone: "blue",
    action: { kind: "prompt", label: "Try it", prompt: `Prompt ${id}` },
    source: { kind: "feature", ref: id },
    addedAt: "1.0.0",
    reviewedAt: "1.0.0",
    held: false,
    priority: 10,
    perVersion: false,
    eligible: () => true,
    retireWhen: () => false,
    boost: () => 0,
    ...overrides,
  };
}

function catalogTip(id: string): TipDefinition {
  const definition = TIP_CATALOG.find((candidate) => candidate.id === id);
  if (definition === undefined) throw new Error(`missing tip ${id}`);
  return definition;
}

function day(offset: number): string {
  return localDay(START + offset * DAY_MS);
}

function visit(
  state: TipsState,
  minutes: number,
  catalog: readonly TipDefinition[],
  overrides: Partial<TipSignals> = {},
  isVisit = true,
): { state: TipsState; ids: string[] } {
  const result = visitFeed(
    state,
    signals(overrides),
    START + minutes * MINUTE_MS,
    isVisit,
    catalog,
  );
  return {
    state: result.state,
    ids: result.tips.map((definition) => definition.id),
  };
}

function numbered(count: number): TipDefinition[] {
  return Array.from({ length: count }, (_, index) =>
    testTip(`t${index + 1}`, { priority: count - index }),
  );
}

const LATER = VISIT_DEBOUNCE_MS / MINUTE_MS + 1;

describe("visitFeed", () => {
  it("fills the first visit with the three highest-ranked tips", () => {
    const first = visit(createTipsState(START, "1.0.0"), 0, numbered(5));
    expect(first.ids).toEqual(["t1", "t2", "t3"]);
    expect(first.state.records.t1?.shownCount).toBe(1);
    expect(first.state.records.t4).toBeUndefined();
  });

  it("keeps the feed during the visit debounce and on refetches", () => {
    const catalog = numbered(5);
    const first = visit(createTipsState(START, "1.0.0"), 0, catalog);
    expect(visit(first.state, 3, catalog).ids).toEqual(["t1", "t2", "t3"]);
    expect(visit(first.state, 60, catalog, {}, false).ids).toEqual([
      "t1",
      "t2",
      "t3",
    ]);
  });

  it("brings one new tip in at the top on each visit after the debounce and drops the oldest", () => {
    const catalog = numbered(6);
    const first = visit(createTipsState(START, "1.0.0"), 0, catalog);
    const second = visit(first.state, LATER, catalog);
    expect(second.ids).toEqual(["t4", "t1", "t2"]);
    const third = visit(second.state, LATER * 2, catalog);
    expect(third.ids).toEqual(["t5", "t4", "t1"]);
  });

  it("replaces a clicked tip with a fresh one on the next visit", () => {
    const catalog = numbered(6);
    const first = visit(createTipsState(START, "1.0.0"), 0, catalog);
    const clicked = actOnTip(
      first.state,
      "t2",
      "1.0.0",
      START + MINUTE_MS,
      catalog,
    );
    expect(visit(clicked, 2, catalog).ids).toEqual(["t1", "t2", "t3"]);
    const next = visit(clicked, LATER, catalog);
    expect(next.ids).toEqual(["t4", "t1", "t3"]);
    expect(next.ids).not.toContain("t2");
  });

  it("cycles through the whole library before repeating, clicked tips last", () => {
    const catalog = numbered(5);
    let state = createTipsState(START, "1.0.0");
    const seen: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const result = visit(state, index * LATER, catalog);
      seen.push(result.ids[0] ?? "");
      state = result.state;
    }
    expect(seen).toEqual(["t1", "t4", "t5"]);
    const repeat = visit(state, 3 * LATER, catalog);
    expect(repeat.ids).toHaveLength(3);
    expect(new Set(repeat.ids).size).toBe(3);
  });

  it("retires a tip for good once its feature is used, and drops dismissed tips", () => {
    const catalog = [
      testTip("feature", {
        priority: 9,
        retireWhen: (current) => current.hasChildThread,
      }),
      ...numbered(3),
    ];
    const used = visit(createTipsState(START, "1.0.0"), 0, catalog, {
      hasChildThread: true,
    });
    expect(used.ids).toEqual(["t1", "t2", "t3"]);
    expect(used.state.records.feature?.retiredReason).toBe("used");
    expect(visit(used.state, LATER, catalog).ids).not.toContain("feature");
    const dismissed = dismissTip(used.state, "t2", "1.0.0", START, catalog);
    expect(visit(dismissed, 1, catalog, {}, false).ids).toEqual(["t1", "t3"]);
  });

  it("puts contextual tips ahead of priority order", () => {
    const catalog = [
      testTip("high", { priority: 9 }),
      testTip("medium", { priority: 5 }),
      testTip("low", { priority: 3 }),
      testTip("waiting", {
        priority: 1,
        boost: (current) => (current.waitingThreadCount > 0 ? 100 : 0),
      }),
    ];
    expect(visit(createTipsState(START, "1.0.0"), 0, catalog).ids).toEqual([
      "high",
      "medium",
      "low",
    ]);
    expect(
      visit(createTipsState(START, "1.0.0"), 0, catalog, {
        waitingThreadCount: 3,
      }).ids,
    ).toEqual(["waiting", "high", "medium"]);
  });

  it("skips held, ineligible, and expired tips", () => {
    const catalog = [
      testTip("held", { priority: 9, held: true }),
      testTip("ineligible", { priority: 8, eligible: () => false }),
      testTip("expired", { priority: 7, expiresAt: "1.0.0" }),
      testTip("shown", { priority: 1 }),
    ];
    expect(visit(createTipsState(START, "1.0.0"), 0, catalog).ids).toEqual([
      "shown",
    ]);
  });

  it("shows nothing while hidden for the day and again on undo", () => {
    const catalog = numbered(3);
    const first = visit(createTipsState(START, "1.0.0"), 0, catalog);
    const hidden = hideTips(first.state, true, day(0));
    expect(visit(hidden, 1, catalog).ids).toEqual([]);
    expect(visit(hideTips(hidden, false, day(0)), 1, catalog).ids).toEqual([
      "t1",
      "t2",
      "t3",
    ]);
  });

  it("brings dismissed tips back and clears the feed after a reset", () => {
    const catalog = [testTip("a")];
    const dismissed = dismissTip(
      visit(createTipsState(START, "1.0.0"), 0, catalog).state,
      "a",
      "1.0.0",
      START,
      catalog,
    );
    const reset = resetTips(dismissed);
    expect(reset.records).toEqual({});
    expect(reset.feed).toBeNull();
    expect(reset.cycle).toEqual([]);
    expect(visit(reset, 0, catalog).ids).toEqual(["a"]);
  });

  it("rejects unknown tip ids", () => {
    expect(() =>
      dismissTip(createTipsState(START, null), "nope", null, START),
    ).toThrow(UnknownTipError);
    expect(() =>
      actOnTip(createTipsState(START, null), "nope", null, START),
    ).toThrow(UnknownTipError);
  });
});

describe("compareVersions", () => {
  it("orders release versions and ignores unparseable ones", () => {
    expect(compareVersions("0.46.0", "0.45.9")).toBeGreaterThan(0);
    expect(compareVersions("0.46.0", "0.46.0")).toBe(0);
    expect(compareVersions("0.0.0-dev", "0.46.0")).toBeNull();
  });
});

describe("classifyAudience", () => {
  const now = START;

  it("treats an install with no threads, or only recent ones, as new", () => {
    expect(classifyAudience(0, [], now)).toBe("new");
    expect(classifyAudience(2, [now - 3 * DAY_MS, now - DAY_MS], now)).toBe(
      "new",
    );
  });

  it("treats an install with a thread older than two weeks, or many threads, as existing", () => {
    expect(classifyAudience(2, [now - 20 * DAY_MS, now - DAY_MS], now)).toBe(
      "existing",
    );
    expect(classifyAudience(500, [], now)).toBe("existing");
  });
});

describe("contextual ranking", () => {
  it("leads with threads waiting on you, then Account Pooler after a recent rate limit", () => {
    const context = {
      hasFinishedThread: true,
      finishedThreadCount: 5,
      threadCount: 20,
      installedPlugins: { "account-pool": false },
      rateLimited: true,
    };
    const ranked = (overrides: Partial<TipSignals>) =>
      rankEligibleTips(
        createTipsState(START, "1.0.0"),
        signals({ ...context, ...overrides }),
      ).map((definition) => definition.id);
    expect(ranked({}).slice(0, 2)).toEqual(["account-pool", "child-threads"]);
    expect(ranked({ recentlyRateLimited: true })[0]).toBe("account-pool");
    expect(
      ranked({ recentlyRateLimited: true, waitingThreadCount: 4 }).slice(0, 2),
    ).toEqual(["open-threads-that-need-me", "account-pool"]);
  });
});

describe("what's new", () => {
  const whatsNew = catalogTip("whats-new");

  it("stays quiet on the version bb was first seen on", () => {
    expect(whatsNew.eligible(signals())).toBe(false);
  });

  it("shows once for each new version and is not repeated after the library runs out", () => {
    const catalog = [whatsNew];
    const upgraded = { appVersion: "1.1.0", firstSeenVersion: "1.0.0" };
    const first = visit(createTipsState(START, "1.0.0"), 0, catalog, upgraded);
    expect(first.ids).toEqual(["whats-new"]);
    const later = visit(first.state, LATER, catalog, upgraded);
    expect(later.ids).toEqual(["whats-new"]);
    const next = visit(later.state, LATER * 2, catalog, {
      appVersion: "1.2.0",
      firstSeenVersion: "1.0.0",
    });
    expect(next.ids).toEqual(["whats-new"]);
  });

  it("names the version and opens the Updates section", () => {
    const view = renderTip(
      whatsNew,
      signals({ appVersion: "1.1.0", firstSeenVersion: "1.0.0" }),
    );
    expect(view.title).toBe("What's new in v1.1.0");
    expect(view.action).toEqual({
      kind: "open-page",
      label: "See what's new",
      path: "/settings/updates#whats-new",
    });
  });
});

describe("catalog predicates", () => {
  it("offers child threads only where they are not in use yet", () => {
    const childThreads = catalogTip("child-threads");
    const finished = { hasFinishedThread: true };
    expect(childThreads.eligible(signals())).toBe(false);
    expect(childThreads.eligible(signals(finished))).toBe(true);
    expect(
      childThreads.eligible(signals({ ...finished, hasChildThread: true })),
    ).toBe(false);
    expect(
      childThreads.eligible(
        signals({ ...finished, hasChildThread: true, projectId: "proj_new" }),
      ),
    ).toBe(true);
    expect(
      childThreads.eligible(
        signals({
          ...finished,
          projectId: "proj_busy",
          projectHasChildThread: true,
        }),
      ),
    ).toBe(false);
    expect(childThreads.action.kind).toBe("prompt");
  });

  it("offers the waiting-threads tip only when two or more threads need you", () => {
    const waiting = catalogTip("open-threads-that-need-me");
    expect(waiting.eligible(signals({ waitingThreadCount: 1 }))).toBe(false);
    expect(waiting.eligible(signals({ waitingThreadCount: 2 }))).toBe(true);
    expect(
      waiting.eligible(
        signals({
          waitingThreadCount: 5,
          client: { surface: "mobile-app", os: "ios" },
        }),
      ),
    ).toBe(false);
  });

  it("offers Account Pooler to rate-limited or heavy users until it is enabled", () => {
    const pool = catalogTip("account-pool");
    const base = { installedPlugins: { "account-pool": false } };
    expect(pool.held).toBe(false);
    expect(pool.eligible(signals(base))).toBe(false);
    expect(pool.eligible(signals({ ...base, rateLimited: true }))).toBe(true);
    expect(pool.eligible(signals({ ...base, threadCount: 50 }))).toBe(true);
    expect(
      pool.eligible(
        signals({ ...base, installedPlugins: {}, rateLimited: true }),
      ),
    ).toBe(false);
    expect(
      pool.retireWhen(signals({ installedPlugins: { "account-pool": true } })),
    ).toBe(true);
  });

  it("offers the phone app only away from the phone and retires it once the mobile app is used", () => {
    const phone = catalogTip("phone");
    const finished = { hasFinishedThread: true };
    expect(phone.eligible(signals(finished))).toBe(true);
    expect(
      phone.eligible(
        signals({ ...finished, client: { surface: "mobile-app", os: "ios" } }),
      ),
    ).toBe(false);
    expect(phone.retireWhen(signals({ usedMobileApp: true }))).toBe(true);
  });

  it("never offers Browser Automation on Windows and retires it once enabled", () => {
    const browser = catalogTip("browser-automation");
    const finished = { hasFinishedThread: true };
    expect(browser.eligible(signals(finished))).toBe(true);
    expect(
      browser.eligible(signals({ ...finished, serverPlatform: "win32" })),
    ).toBe(false);
    expect(
      browser.eligible(
        signals({ ...finished, client: { surface: "web", os: "windows" } }),
      ),
    ).toBe(false);
    expect(
      browser.retireWhen(
        signals({ installedPlugins: { "browser-automation": true } }),
      ),
    ).toBe(true);
  });

  it("limits keyboard tips to keyboard clients and uses the client's shortcut", () => {
    const palette = catalogTip("command-palette");
    const settled = { daysSinceFirstSeen: 3 };
    expect(palette.eligible(signals(settled))).toBe(true);
    expect(
      palette.eligible(
        signals({
          ...settled,
          client: { surface: "mobile-web", os: "android" },
        }),
      ),
    ).toBe(false);
    expect(renderTip(palette, signals(settled)).body).toContain("⌘⇧P");
    expect(
      renderTip(
        palette,
        signals({ ...settled, client: { surface: "web", os: "windows" } }),
      ).body,
    ).toContain("Ctrl+Shift+P");
    expect(palette.action).toEqual({
      kind: "run-command",
      label: "Open palette",
      commandId: "palette.open",
    });
  });

  it("offers automations only where none has run yet", () => {
    const automations = catalogTip("automations");
    const ready = {
      finishedThreadCount: 5,
      installedPlugins: { automations: true },
    };
    expect(automations.eligible(signals(ready))).toBe(true);
    expect(
      automations.eligible(signals({ ...ready, installedPlugins: {} })),
    ).toBe(false);
    expect(
      automations.eligible(signals({ ...ready, hasAutomationThread: true })),
    ).toBe(false);
    expect(
      automations.eligible(
        signals({
          ...ready,
          projectId: "proj_1",
          projectHasAutomationThread: true,
        }),
      ),
    ).toBe(false);
    expect(
      automations.eligible(
        signals({ ...ready, projectId: "proj_2", hasAutomationThread: true }),
      ),
    ).toBe(true);
  });
});

describe("observations", () => {
  it("records the first seen version once and keeps sticky usage facts", () => {
    const initial = createTipsState(START, null);
    const observed = observeLiveSignals(
      initial,
      live({ appVersion: "2.0.0", finishedThreadCount: 1 }),
      { surface: "mobile-app", os: "ios" },
      START,
    );
    expect(observed.firstSeenVersion).toBe("2.0.0");
    expect(observed.observed).toMatchObject({
      finishedThread: true,
      mobileAppAt: START,
    });
    const later = observeLiveSignals(
      observed,
      live({ appVersion: "2.1.0", finishedThreadCount: 0 }),
      { surface: "web", os: "macos" },
      START + DAY_MS,
    );
    expect(later.firstSeenVersion).toBe("2.0.0");
    const derived = deriveSignals(
      later,
      live({ appVersion: "2.1.0" }),
      null,
      START + 3 * DAY_MS,
    );
    expect(derived).toMatchObject({
      hasFinishedThread: true,
      usedMobileApp: true,
      daysSinceFirstSeen: 3,
      firstSeenVersion: "2.0.0",
      appVersion: "2.1.0",
    });
  });

  it("refuses malformed stored state", () => {
    expect(parseTipsState({ version: 3 })).toBeNull();
    const state = createTipsState(START, "1.0.0");
    expect(parseTipsState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });
});

describe("listTips", () => {
  it("lists the feed first, newest at the top, and hides retired tips unless all are requested", () => {
    const catalog = [
      ...numbered(4),
      testTip("off", { priority: 0, eligible: () => false }),
    ];
    const first = visit(createTipsState(START, "1.0.0"), 0, catalog);
    const dismissed = dismissTip(first.state, "t4", "1.0.0", START, catalog);
    const eligible = listTips(dismissed, signals(), day(0), false, catalog);
    expect(eligible.map((entry) => [entry.id, entry.status])).toEqual([
      ["t1", "in-feed"],
      ["t2", "in-feed"],
      ["t3", "in-feed"],
    ]);
    const all = listTips(dismissed, signals(), day(0), true, catalog);
    expect(all.map((entry) => [entry.id, entry.status])).toEqual([
      ["t1", "in-feed"],
      ["t2", "in-feed"],
      ["t3", "in-feed"],
      ["t4", "dismissed"],
      ["off", "not-applicable"],
    ]);
    expect(all[0]).toMatchObject({ shownCount: 1, dismissed: false });
    const hidden = listTips(
      hideTips(dismissed, true, day(0)),
      signals(),
      day(0),
      false,
      catalog,
    );
    expect(hidden.map((entry) => entry.status)).toEqual([
      "eligible",
      "eligible",
      "eligible",
    ]);
  });
});

describe("isWaitingOnUser", () => {
  const row = {
    status: "idle",
    hasPendingInteraction: false,
    lastReadAt: 10,
    latestAttentionAt: 5,
  };

  it("counts unread results, errors, and open questions but not running or read threads", () => {
    expect(isWaitingOnUser(row)).toBe(false);
    expect(isWaitingOnUser({ ...row, latestAttentionAt: 20 })).toBe(true);
    expect(isWaitingOnUser({ ...row, lastReadAt: null })).toBe(true);
    expect(isWaitingOnUser({ ...row, status: "error" })).toBe(true);
    expect(
      isWaitingOnUser({ ...row, status: "active", latestAttentionAt: 20 }),
    ).toBe(false);
    expect(
      isWaitingOnUser({
        ...row,
        status: "active",
        hasPendingInteraction: true,
      }),
    ).toBe(true);
  });
});
