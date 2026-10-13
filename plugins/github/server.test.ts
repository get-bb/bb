import { describe, expect, it } from "vitest";
import { parseExtraRepos, parsePaginatedGhApi } from "./server";

describe("GitHub RPC contract", () => {
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
