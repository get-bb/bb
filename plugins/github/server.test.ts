import { describe, expect, it } from "vitest";
import { fetchRepoItems, parseExtraRepos, parsePaginatedGhApi } from "./server";

describe("GitHub RPC contract", () => {
  it("keeps pull requests when a repository has GitHub Issues disabled", async () => {
    const calls: string[][] = [];
    const items = await fetchRepoItems(async (args) => {
      calls.push(args);
      return JSON.stringify({
        data: {
          repository: {
            hasIssuesEnabled: false,
            openIssues: { nodes: [] },
            closedIssues: { nodes: [] },
            openPrs: {
              nodes: [
                {
                  number: 17,
                  title: "Keep syncing pull requests",
                  state: "OPEN",
                  author: { login: "octocat" },
                  labels: { nodes: [{ name: "bug" }] },
                  assignees: { nodes: [] },
                  url: "https://github.com/acme/widgets/pull/17",
                  body: "",
                  updatedAt: "2026-08-10T00:00:00Z",
                },
              ],
            },
            closedPrs: { nodes: [] },
          },
        },
      });
    }, "acme/widgets");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.slice(0, 2)).toEqual(["api", "graphql"]);
    expect(items).toEqual([
      expect.objectContaining({
        repo: "acme/widgets",
        number: 17,
        kind: "pr",
        title: "Keep syncing pull requests",
      }),
    ]);
  });

  it("flattens every paginated GitHub API page", () => {
    expect(
      parsePaginatedGhApi(
        JSON.stringify([[{ id: 1 }, { id: 2 }], [{ id: 3 }]]),
      ),
    ).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);

    expect(() => parsePaginatedGhApi(JSON.stringify([{ id: 1 }]))).toThrow(
      "malformed page",
    );
  });

  it("separates usable extraRepos entries from ones it cannot honor", () => {
    expect(parseExtraRepos("get-bb/bb, nonsense")).toEqual({
      repos: ["get-bb/bb"],
      ignored: ["nonsense"],
    });
    expect(parseExtraRepos("SOME-ORG/*")).toEqual({
      repos: [],
      ignored: ["SOME-ORG/*"],
    });
    expect(parseExtraRepos("")).toEqual({ repos: [], ignored: [] });
    expect(parseExtraRepos("  ,, \n ")).toEqual({ repos: [], ignored: [] });
    expect(parseExtraRepos(" acme/one\nacme/two , acme/one ")).toEqual({
      repos: ["acme/one", "acme/two"],
      ignored: [],
    });
    expect(parseExtraRepos("bad/repo/shape acme").ignored).toEqual([
      "bad/repo/shape",
      "acme",
    ]);
  });
});
