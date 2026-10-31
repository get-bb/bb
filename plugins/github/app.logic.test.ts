import { describe, expect, it } from "vitest";
import {
  addQueryToken,
  buildSuggestions,
  checkCounts,
  detailPullStatus,
  diffSizeBlocks,
  groupPullEvents,
  inboxCount,
  inboxRows,
  issueGroups,
  linearLinkback,
  matchesQuery,
  middleTruncate,
  openedAsDraft,
  parseCollapsed,
  parseQuery,
  parseSubPath,
  pullEventText,
  pullRowModels,
  pullStateActions,
  pullViewGroups,
  queryChips,
  removeQueryToken,
  routeToSubPath,
  splitTitle,
  type DetailStatusInput,
  type Item,
  type Route,
} from "./app-logic.js";
import { assemblePullStatus, type RawPullStatus } from "./pull-status.js";

const issue: Item = {
  repo: "acme/widgets",
  number: 7,
  kind: "issue",
  title: "Fix cache invalidation",
  state: "OPEN",
  author: "alice",
  labels: ["bug", "good first issue"],
  assignees: ["octocat"],
  url: "https://github.com/acme/widgets/issues/7",
  body: "",
  updatedAt: "2026-08-19T12:00:00Z",
  pr: null,
  snooze: null,
};

function raw(overrides: Partial<RawPullStatus> = {}): RawPullStatus {
  return {
    state: "OPEN",
    isDraft: false,
    baseRefName: "main",
    headRefName: "feature/cache",
    headRefOid: "0000000",
    isCrossRepository: false,
    additions: 10,
    deletions: 2,
    changedFiles: 1,
    mergedAt: null,
    checksVerdict: null,
    stack: null,
    headOwner: null,
    mergeable: "MERGEABLE",
    reviewDecision: null,
    isInMergeQueue: false,
    requestedReviewers: [],
    checkRunCounts: [{ state: "SUCCESS", count: 4 }],
    statusContextCounts: [],
    ...overrides,
  };
}

function pull(overrides: Partial<RawPullStatus> = {}, author = "alice"): Item {
  return {
    ...issue,
    kind: "pr",
    number: 42,
    title: "feat(cache): drop stale entries",
    author,
    labels: [],
    assignees: [],
    pr: assemblePullStatus(raw(overrides)),
  };
}

describe("github panel routes", () => {
  it("round-trips list, create, issue, and pull routes", () => {
    const routes: Route[] = [
      { view: "issues" },
      { view: "pulls", tab: "inbox" },
      { view: "pulls", tab: "mine" },
      { view: "pulls", tab: "all" },
      { view: "pulls", tab: "merged" },
      { view: "new" },
      { view: "issue", repo: "acme/widgets", number: 7 },
      { view: "pull", repo: "get-bb/bb", number: 42 },
    ];

    for (const route of routes) {
      expect(parseSubPath(routeToSubPath(route))).toEqual(route);
    }
  });

  it("falls back to the owning list for malformed detail paths", () => {
    expect(parseSubPath("pulls/acme/widgets/not-a-number")).toEqual({
      view: "pulls",
      tab: "inbox",
    });
    expect(parseSubPath("pulls/everything")).toEqual({
      view: "pulls",
      tab: "inbox",
    });
    expect(parseSubPath("issues/acme/widgets/not-a-number")).toEqual({
      view: "issues",
    });
    expect(parseSubPath("issues/acme/widgets/7/extra")).toEqual({
      view: "issues",
    });
    expect(parseSubPath("")).toEqual({ view: "pulls", tab: "inbox" });
    expect(parseSubPath("somewhere/else")).toEqual({
      view: "pulls",
      tab: "inbox",
    });
  });

  it("reads remembered collapsed groups, ignoring anything malformed", () => {
    expect([...parseCollapsed('["draft","closed"]')]).toEqual([
      "draft",
      "closed",
    ]);
    expect([...parseCollapsed('["draft",3]')]).toEqual(["draft"]);
    expect(parseCollapsed("{").size).toBe(0);
    expect(parseCollapsed('{"draft":true}').size).toBe(0);
    expect(parseCollapsed(null).size).toBe(0);
  });
});

describe("filter queries", () => {
  it("parses quoted qualifiers and matches viewer-relative filters", () => {
    const parsed = parseQuery(
      'is:open assignee:@me author:alice label:"good first issue" repo:acme/widgets #7',
    );

    expect(parsed).toEqual({
      states: ["OPEN"],
      flags: [],
      bases: [],
      assignees: ["@me"],
      authors: ["alice"],
      labels: ["good first issue"],
      repos: ["acme/widgets"],
      noAssignee: false,
      noLabel: false,
      text: ["#7"],
    });
    expect(matchesQuery(issue, parsed, "octocat")).toBe(true);
    expect(matchesQuery(issue, parsed, null)).toBe(false);
  });

  it("applies negative, state, and plain-text filters independently", () => {
    expect(matchesQuery(issue, parseQuery("is:closed"), "octocat")).toBe(false);
    expect(matchesQuery(issue, parseQuery("no:assignee"), "octocat")).toBe(
      false,
    );
    expect(matchesQuery(issue, parseQuery("no:label"), "octocat")).toBe(false);
    expect(
      matchesQuery(issue, parseQuery("cache acme/widgets"), "octocat"),
    ).toBe(true);
    expect(matchesQuery(issue, parseQuery("missing"), "octocat")).toBe(false);
    expect(matchesQuery(issue, parseQuery("state:"), "octocat")).toBe(true);
  });

  it("finds drafts, ready, conflicting, failing, and snoozed pull requests", () => {
    const matches = (item: Item, query: string) =>
      matchesQuery(item, parseQuery(query), "octocat");
    const draft = pull({ isDraft: true });
    expect(draft.state).toBe("OPEN");
    expect(matches(draft, "is:draft")).toBe(true);
    expect(matches(draft, "is:open is:draft")).toBe(true);
    expect(matches(pull(), "is:draft")).toBe(false);
    expect(matches(issue, "is:draft")).toBe(false);
    expect(matches(pull(), "is:ready")).toBe(true);
    expect(matches(pull({ mergeable: "CONFLICTING" }), "is:conflicts")).toBe(
      true,
    );
    const failing = pull({ checkRunCounts: [{ state: "FAILURE", count: 2 }] });
    expect(matches(failing, "is:failing")).toBe(true);
    expect(matches(failing, "is:ready")).toBe(false);
    expect(
      matches(
        { ...pull(), snooze: { rule: "checks", until: null } },
        "is:snoozed",
      ),
    ).toBe(true);
    expect(matches(pull(), "is:snoozed")).toBe(false);
  });

  it("matches base:, author:me, and the head branch as plain text", () => {
    const matches = (item: Item, query: string) =>
      matchesQuery(item, parseQuery(query), "octocat");
    expect(matches(pull(), "base:main")).toBe(true);
    expect(matches(pull(), "base:dev")).toBe(false);
    expect(matches(pull({}, "octocat"), "author:me")).toBe(true);
    expect(matches(pull({}, "octocat"), "author:@me")).toBe(true);
    expect(matches(pull(), "author:me")).toBe(false);
    expect(matches(pull(), "feature/cache")).toBe(true);
  });

  it("has no agent, CI, or stack qualifiers: they are plain text", () => {
    expect(parseQuery("ci:failing agent:running stack:yes").text).toEqual([
      "ci:failing",
      "agent:running",
      "stack:yes",
    ]);
    expect(queryChips("ci:failing", "octocat").map((chip) => chip.key)).toEqual(
      ["Contains"],
    );
  });

  it("suggests only the qualifiers and values that apply to the kind", () => {
    const vocab = {
      users: ["alice", "octocat"],
      labels: ["bug", "good first issue"],
      repos: ["acme/widgets"],
      bases: ["main", "release"],
    };
    const labels = (token: string, kind: "issue" | "pr") =>
      buildSuggestions(token, vocab, kind, "octocat").map(
        (suggestion) => suggestion.label,
      );

    expect(labels("is:", "pr")).toEqual([
      "open",
      "closed",
      "merged",
      "draft",
      "ready",
      "conflict",
      "failing",
      "snoozed",
    ]);
    expect(labels("is:", "issue")).toEqual(["open", "closed"]);
    expect(
      buildSuggestions("is:", vocab, "pr", "octocat").map(
        (suggestion) => suggestion.hint,
      ),
    ).toEqual([
      "is open",
      "is closed",
      "is merged",
      "is a draft",
      "is ready to merge",
      "has conflicts",
      "checks are failing",
      "is snoozed",
    ]);
    expect(labels("", "pr")).toEqual([
      "is:",
      "author:",
      "assignee:",
      "label:",
      "base:",
      "repo:",
      "no:",
    ]);
    expect(labels("", "issue")).not.toContain("base:");
    expect(labels("base:re", "pr")).toEqual(["release"]);
    expect(labels("base:", "issue")).toEqual([]);
    expect(labels("ci:", "pr")).toEqual([]);
    expect(buildSuggestions("label:good", vocab, "issue", "octocat")).toEqual([
      { insert: 'label:"good first issue" ', label: "good first issue" },
    ]);
    expect(labels("assignee:@", "issue")).toEqual(["@me (octocat)"]);
    expect(labels("no:l", "issue")).toEqual(["no:label"]);
    expect(buildSuggestions("is:o", vocab, "pr", "octocat")[0]?.icon).toEqual({
      kind: "state",
      itemKind: "pr",
      state: "OPEN",
    });
    expect(
      buildSuggestions("author:ali", vocab, "issue", "octocat")[0]?.icon,
    ).toEqual({ kind: "avatar", login: "alice" });
  });
});

describe("filter chips", () => {
  it("describes each token in words and removes one at a time", () => {
    const query = "is:draft author:me is:failing cache ";
    expect(queryChips(query, "octocat")).toEqual([
      { index: 0, key: "Is", value: "a draft" },
      { index: 1, key: "Author is", value: "octocat" },
      { index: 2, key: "Checks are", value: "failing" },
      { index: 3, key: "Contains", value: "cache" },
    ]);
    expect(removeQueryToken(query, 1)).toBe("is:draft is:failing cache ");
    expect(removeQueryToken("is:draft", 0)).toBe("");
    expect(addQueryToken("is:draft", "label:bug")).toBe("is:draft label:bug ");
    expect(addQueryToken("", "is:failing")).toBe("is:failing ");
  });

  it("shows no chip for a qualifier that is still being typed", () => {
    expect(queryChips("author: label:", "octocat")).toEqual([]);
    expect(queryChips("author:@me", null)).toEqual([
      { index: 0, key: "Author is", value: "you" },
    ]);
  });
});

describe("titles", () => {
  it("splits a conventional commit prefix from the title", () => {
    expect(splitTitle("feat(api): add retries")).toEqual({
      prefix: "feat(api):",
      text: "add retries",
    });
    expect(splitTitle("fix!: stop the loop")).toEqual({
      prefix: "fix!:",
      text: "stop the loop",
    });
    expect(splitTitle("Add retries (LIN-123)")).toEqual({
      prefix: null,
      text: "Add retries (LIN-123)",
    });
  });

  it("truncates in the middle", () => {
    expect(middleTruncate("short", 10)).toBe("short");
    expect(middleTruncate("someone/very-long-branch-name", 11)).toBe(
      "someo…-name",
    );
  });

  it("fills the same five blocks as core's DiffSizeBar", () => {
    expect(diffSizeBlocks(0, 0)).toEqual([
      "empty",
      "empty",
      "empty",
      "empty",
      "empty",
    ]);
    expect(diffSizeBlocks(74, 14)).toEqual([
      "added",
      "added",
      "added",
      "removed",
      "empty",
    ]);
    expect(diffSizeBlocks(10, 2_000)).toEqual([
      "removed",
      "removed",
      "removed",
      "removed",
      "removed",
    ]);
  });
});

describe("pull request status actions", () => {
  const allowed = {
    isDraft: false,
    viewerCanUpdate: true,
    viewerCanClose: true,
    viewerCanReopen: true,
  };
  const labels = (pullState: Parameters<typeof pullStateActions>[0]) =>
    pullStateActions(pullState).map((action) => [action.label, action.target]);

  it("names each move with core's verbs", () => {
    expect(labels({ ...allowed, state: "OPEN" })).toEqual([
      ["Convert to draft", "draft"],
      ["Close pull request", "closed"],
    ]);
    expect(labels({ ...allowed, isDraft: true, state: "DRAFT" })).toEqual([
      ["Mark ready", "open"],
      ["Close pull request", "closed"],
    ]);
    expect(labels({ ...allowed, state: "CLOSED" })).toEqual([
      ["Reopen pull request", "open"],
    ]);
    expect(labels({ ...allowed, isDraft: true, state: "CLOSED" })).toEqual([
      ["Reopen pull request", "draft"],
    ]);
    expect(labels({ ...allowed, state: "MERGED" })).toEqual([]);
  });

  it("hides what GitHub says the viewer cannot do", () => {
    expect(
      labels({ ...allowed, viewerCanUpdate: false, state: "OPEN" }),
    ).toEqual([["Close pull request", "closed"]]);
    expect(
      labels({
        ...allowed,
        isDraft: true,
        viewerCanClose: false,
        state: "DRAFT",
      }),
    ).toEqual([["Mark ready", "open"]]);
    expect(
      labels({ ...allowed, viewerCanReopen: false, state: "CLOSED" }),
    ).toEqual([]);
  });
});

describe("pull request lists", () => {
  const at = (
    number: number,
    author: string,
    overrides: Partial<RawPullStatus> = {},
    extra: Partial<Item> = {},
  ): Item => ({
    ...pull({ headRefName: `branch-${number}`, ...overrides }, author),
    number,
    title: `Pull ${number}`,
    ...extra,
  });
  const items = [
    at(1, "octocat"),
    at(2, "octocat", { baseRefName: "branch-1" }),
    at(3, "octocat", { checkRunCounts: [{ state: "FAILURE", count: 1 }] }),
    at(4, "octocat", { isDraft: true }),
    at(5, "hubot", { requestedReviewers: ["octocat"] }),
    at(6, "hubot", { state: "MERGED", mergedAt: "2026-08-19T00:00:00Z" }),
    at(7, "hubot", { state: "MERGED", mergedAt: "2026-08-21T00:00:00Z" }),
    at(
      8,
      "hubot",
      { requestedReviewers: ["octocat"] },
      {
        snooze: { rule: "checks", until: null },
      },
    ),
    at(9, "octocat", { checkRunCounts: [{ state: "IN_PROGRESS", count: 1 }] }),
    at(10, "hubot"),
    at(11, "hubot", { checkRunCounts: [{ state: "FAILURE", count: 1 }] }),
  ];
  const rows = pullRowModels(items, "octocat");
  const ids = (groups: ReturnType<typeof pullViewGroups>) =>
    groups.map((group) => [group.id, group.rows.map((row) => row.item.number)]);

  it("links stacked pull requests both ways", () => {
    const byNumber = new Map(rows.map((row) => [row.item.number, row]));
    expect(byNumber.get(2)?.chain).toEqual([1, 2]);
    expect(byNumber.get(1)?.chain).toEqual([1, 2]);
    expect(byNumber.get(8)?.group).toBe("snoozed");
    expect(
      rows.every((row) => row.key === `acme/widgets#${row.item.number}`),
    ).toBe(true);
  });

  it("keeps the inbox to what needs the viewer, not everyone's pull requests", () => {
    expect(
      ids(pullViewGroups(rows, "inbox", parseQuery(""), "octocat")),
    ).toEqual([
      ["you", [5]],
      ["ready", [1, 2]],
      ["fixing", [3]],
      ["progress", [9]],
      ["snoozed", [8]],
    ]);
    expect(ids(pullViewGroups(rows, "all", parseQuery(""), "octocat"))).toEqual(
      [
        ["you", [5]],
        ["ready", [1, 2, 10]],
        ["fixing", [3, 11]],
        ["progress", [9]],
        ["draft", [4]],
        ["snoozed", [8]],
      ],
    );
    expect(ids(pullViewGroups(rows, "inbox", parseQuery(""), null))).toEqual(
      [],
    );
  });

  it("counts the same rows for the tab, the badge, and the home section", () => {
    expect(inboxRows(rows, "octocat").map((row) => row.item.number)).toEqual([
      5, 1, 2, 3,
    ]);
    expect(inboxCount(rows, "octocat")).toBe(4);
    expect(inboxCount(rows, "hubot")).toBe(2);
  });

  it("orders merged pull requests newest first and filters every view", () => {
    expect(
      ids(pullViewGroups(rows, "merged", parseQuery(""), "octocat")),
    ).toEqual([["merged", [7, 6]]]);
    expect(
      ids(pullViewGroups(rows, "mine", parseQuery("is:draft"), "octocat")),
    ).toEqual([["draft", [4]]]);
  });

  it("splits issues into open and closed after the filter", () => {
    const closed = { ...issue, number: 8, state: "CLOSED", title: "Old bug" };
    expect(
      issueGroups([issue, closed], parseQuery(""), "octocat").map((group) => [
        group.id,
        group.rows.map((row) => row.number),
      ]),
    ).toEqual([
      ["open", [7]],
      ["closed", [8]],
    ]);
    expect(issueGroups([issue, closed], parseQuery("old"), "octocat")).toEqual([
      { id: "closed", label: "Closed", rows: [closed] },
    ]);
  });
});

describe("pull request detail facts", () => {
  const detail: DetailStatusInput = {
    state: "OPEN",
    isDraft: false,
    baseRefName: "main",
    headRefName: "feature",
    headRefOid: "abc",
    isCrossRepository: false,
    additions: 1,
    deletions: 1,
    changedFiles: 1,
    mergedAt: null,
    mergeable: "MERGEABLE",
    reviewDecision: "",
    isInMergeQueue: false,
    reviewRequests: [],
    checksVerdict: null,
    checks: [{ status: "success" }, { status: "skipped" }],
    stack: null,
  };

  it("counts skipped checks apart, so they never read as failing or running", () => {
    expect(
      checkCounts([
        { status: "success" },
        { status: "skipped" },
        { status: "failure" },
        { status: "pending" },
        { status: "skipped" },
      ]),
    ).toEqual({ passed: 1, failed: 1, pending: 1, skipped: 2 });
    expect(detailPullStatus(detail).attention).toBe("ready_to_merge");
    expect(detailPullStatus(detail).checks.state).toBe("passing");
  });

  it("reads the list's status from the detail payload", () => {
    expect(
      detailPullStatus({
        ...detail,
        checks: [{ status: "failure" }, { status: "success" }],
      }).checks,
    ).toMatchObject({ state: "failing", failed: 1, passed: 1 });
    expect(detailPullStatus({ ...detail, state: "DRAFT" }).state).toBe("draft");
    expect(
      detailPullStatus({
        ...detail,
        stack: { number: 3, position: 1, entries: [{}, {}, {}] },
      }).stack,
    ).toEqual({ number: 3, size: 3, position: 1 });
  });

  it("folds runs of commits, drops the close that a merge implies, and says whether it opened as a draft", () => {
    const events = [
      {
        kind: "merged" as const,
        actor: "octocat",
        createdAt: "2026-08-20T05:00:00Z",
        detail: null,
      },
      {
        kind: "commit" as const,
        actor: "octocat",
        createdAt: "2026-08-20T01:00:00Z",
        detail: "First",
      },
      {
        kind: "commit" as const,
        actor: "octocat",
        createdAt: "2026-08-20T02:00:00Z",
        detail: "Second",
      },
      {
        kind: "ready" as const,
        actor: "octocat",
        createdAt: "2026-08-20T03:00:00Z",
        detail: null,
      },
      {
        kind: "commit" as const,
        actor: "hubot",
        createdAt: "2026-08-20T04:00:00Z",
        detail: null,
      },
      {
        kind: "closed" as const,
        actor: "octocat",
        createdAt: "2026-08-20T05:00:00Z",
        detail: null,
      },
    ];
    const grouped = groupPullEvents(events);
    expect(grouped.map((event) => pullEventText(event))).toEqual([
      "pushed 2 commits",
      "marked this pull request as ready for review",
      "pushed a commit",
      "merged this pull request",
    ]);
    expect(grouped[0]?.createdAt).toBe("2026-08-20T02:00:00Z");
    expect(openedAsDraft(events, false)).toBe(true);
    expect(openedAsDraft([], true)).toBe(true);
    expect(openedAsDraft([], false)).toBe(false);
  });

  it("finds Linear's linkback in a comment", () => {
    expect(
      linearLinkback(
        '<p><a href="https://linear.app/acme/issue/ENG-12/fix-cache">ENG-12 Fix the cache</a></p>\n<!-- linear-linkback -->',
      ),
    ).toEqual({
      key: "ENG-12",
      title: "Fix the cache",
      url: "https://linear.app/acme/issue/ENG-12/fix-cache",
    });
    expect(linearLinkback("Plain comment about ENG-12")).toBeNull();
  });
});
