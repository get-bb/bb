import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStorage } from "../../test-fixtures.js";
import {
  DEFAULT_LIST_PREFERENCE,
  LIST_PREFERENCE_STORAGE_KEY,
  listPreferenceScope,
  loadListPreference,
  sanitizeListPreference,
  storeListPreference,
} from "./list-preference.js";

let storage = createMemoryStorage();

beforeEach(() => {
  storage = createMemoryStorage();
  vi.stubGlobal("window", { localStorage: storage });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("listPreferenceScope", () => {
  it("maps list surfaces to independent scopes", () => {
    expect(listPreferenceScope(null, false)).toBe("all");
    expect(listPreferenceScope(null, true)).toBe("active");
    expect(listPreferenceScope("01HZZZZZZZZZZZZZZZZZZZZZP1", false)).toBe(
      "project:01HZZZZZZZZZZZZZZZZZZZZZP1",
    );
    expect(listPreferenceScope("01HZZZZZZZZZZZZZZZZZZZZZP1", true)).toBe(
      "active",
    );
  });
});

describe("sanitizeListPreference", () => {
  it("returns defaults for missing or garbage input", () => {
    expect(sanitizeListPreference(undefined)).toEqual({
      filters: { statuses: [], priorities: [], labelNames: [] },
      sort: "manual",
      expandedTaskIds: [],
    });
    expect(sanitizeListPreference(null)).toEqual({
      filters: { statuses: [], priorities: [], labelNames: [] },
      sort: "manual",
      expandedTaskIds: [],
    });
    expect(sanitizeListPreference("nope")).toEqual({
      filters: { statuses: [], priorities: [], labelNames: [] },
      sort: "manual",
      expandedTaskIds: [],
    });
  });

  it("drops invalid statuses, priorities, and sort; keeps label names", () => {
    expect(
      sanitizeListPreference({
        filters: {
          statuses: ["todo", "not-a-status", "todo", "done"],
          priorities: ["high", 3, "high", "telepathic"],
          labelNames: [" Bug ", "", "Bug", "Feature", 12],
        },
        sort: "priority-please",
        expandedTaskIds: [],
      }),
    ).toEqual({
      filters: {
        statuses: ["todo", "done"],
        priorities: ["high"],
        labelNames: ["Bug", "Feature"],
      },
      sort: "manual",
      expandedTaskIds: [],
    });
  });

  it("accepts a valid preference and known sort modes", () => {
    expect(
      sanitizeListPreference({
        filters: {
          statuses: ["in_progress"],
          priorities: ["urgent", "none"],
          labelNames: ["infra"],
        },
        sort: "due",
        expandedTaskIds: [],
      }),
    ).toEqual({
      filters: {
        statuses: ["in_progress"],
        priorities: ["urgent", "none"],
        labelNames: ["infra"],
      },
      sort: "due",
      expandedTaskIds: [],
    });
  });
});

describe("expanded sub-task parents", () => {
  it("keeps unique task ids and drops anything else", () => {
    expect(
      sanitizeListPreference({
        sort: "manual",
        expandedTaskIds: ["task-a", "task-a", "", 3, null, "task-b"],
      }).expandedTaskIds,
    ).toEqual(["task-a", "task-b"]);
  });

  it("stores expanded parents per scope beside filters and sort", () => {
    storeListPreference("all", {
      filters: { statuses: [], priorities: [], labelNames: [] },
      sort: "manual",
      expandedTaskIds: ["task-a"],
    });
    expect(loadListPreference("all").expandedTaskIds).toEqual(["task-a"]);
    expect(loadListPreference("active").expandedTaskIds).toEqual([]);
  });
});

describe("loadListPreference / storeListPreference", () => {
  it("defaults when storage is empty", () => {
    expect(loadListPreference("all")).toEqual({
      filters: { ...DEFAULT_LIST_PREFERENCE.filters },
      sort: "manual",
      expandedTaskIds: [],
    });
  });

  it("persists an explicit clear (empty filters + manual sort)", () => {
    storeListPreference("all", {
      filters: { statuses: ["todo"], priorities: [], labelNames: [] },
      sort: "priority",
      expandedTaskIds: [],
    });
    storeListPreference("all", {
      filters: { statuses: [], priorities: [], labelNames: [] },
      sort: "manual",
      expandedTaskIds: [],
    });
    expect(loadListPreference("all")).toEqual({
      filters: { statuses: [], priorities: [], labelNames: [] },
      sort: "manual",
      expandedTaskIds: [],
    });
  });

  it("recovers from corrupt JSON and invalid document shapes", () => {
    storage.setItem(LIST_PREFERENCE_STORAGE_KEY, "{not-json");
    expect(loadListPreference("all").sort).toBe("manual");

    storage.setItem(
      LIST_PREFERENCE_STORAGE_KEY,
      JSON.stringify({ version: 1, scopes: "nope" }),
    );
    expect(loadListPreference("all").filters.statuses).toEqual([]);

    storage.setItem(
      LIST_PREFERENCE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        scopes: {
          all: {
            filters: { statuses: ["bogus"], priorities: ["high"] },
            sort: "priority",
            expandedTaskIds: [],
          },
        },
      }),
    );
    expect(loadListPreference("all")).toEqual({
      filters: { statuses: [], priorities: ["high"], labelNames: [] },
      sort: "priority",
      expandedTaskIds: [],
    });
  });

  it("best-effort reads scopes from an unknown future version without rewriting it", () => {
    const future = JSON.stringify({
      version: 99,
      scopes: {
        all: {
          filters: { statuses: ["todo"], priorities: [], labelNames: [] },
          sort: "due",
          extraFutureField: true,
        },
      },
    });
    storage.setItem(LIST_PREFERENCE_STORAGE_KEY, future);
    expect(loadListPreference("all")).toEqual({
      filters: { statuses: ["todo"], priorities: [], labelNames: [] },
      sort: "due",
      expandedTaskIds: [],
    });
    storeListPreference("all", {
      filters: { statuses: ["done"], priorities: [], labelNames: [] },
      sort: "manual",
      expandedTaskIds: [],
    });
    expect(storage.getItem(LIST_PREFERENCE_STORAGE_KEY)).toBe(future);
  });

  it("swallows storage read failures", () => {
    vi.spyOn(storage, "getItem").mockImplementation(() => {
      throw new DOMException("Storage is disabled", "SecurityError");
    });
    expect(loadListPreference("all")).toEqual({
      filters: { statuses: [], priorities: [], labelNames: [] },
      sort: "manual",
      expandedTaskIds: [],
    });
  });
});
