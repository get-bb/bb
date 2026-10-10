import { describe, expect, it } from "vitest";
import { getSkillDetailRoutePath } from "./route-paths";
import {
  findBackTargetIndex,
  findForwardTargetIndex,
  reduceHistory,
  type AppRouteHistoryState,
} from "./app-route-history";

const TOOL_SKILL_DETAIL_ROUTE = getSkillDetailRoutePath({
  skillId: "skill_review_loop",
});

const TOOL_ROUTE_SEQUENCE = [
  "/skills",
  "/skills/registry",
  TOOL_SKILL_DETAIL_ROUTE,
  "/skills/registry/moss-skills%2Fmoss-notes",
  "/plugins",
  "/plugins/github",
] as const;

function currentUrl(state: AppRouteHistoryState): string | undefined {
  return state.entries[state.index]?.url;
}

function popTo(
  state: AppRouteHistoryState,
  target: number | null,
): AppRouteHistoryState {
  expect(target).not.toBeNull();
  const entry = state.entries[target ?? state.index];
  return reduceHistory(state, "POP", { key: entry.key, url: entry.url });
}

describe("app route history stack", () => {
  it("tracks every Tools route for sidebar back and forward controls", () => {
    let state: AppRouteHistoryState = {
      entries: [{ key: "default", url: "/" }],
      index: 0,
    };
    TOOL_ROUTE_SEQUENCE.forEach((url, position) => {
      state = reduceHistory(state, "PUSH", { key: `k${position}`, url });
    });

    expect(findBackTargetIndex(state)).not.toBeNull();
    expect(findForwardTargetIndex(state)).toBeNull();

    const backUrls: Array<string | undefined> = [];
    for (let step = 0; step < TOOL_ROUTE_SEQUENCE.length; step += 1) {
      state = popTo(state, findBackTargetIndex(state));
      backUrls.push(currentUrl(state));
    }
    expect(backUrls).toEqual([
      "/plugins",
      "/skills/registry/moss-skills%2Fmoss-notes",
      TOOL_SKILL_DETAIL_ROUTE,
      "/skills/registry",
      "/skills",
      "/",
    ]);

    expect(findBackTargetIndex(state)).toBeNull();
    expect(findForwardTargetIndex(state)).not.toBeNull();

    const forwardUrls: Array<string | undefined> = [];
    for (let step = 0; step < TOOL_ROUTE_SEQUENCE.length; step += 1) {
      state = popTo(state, findForwardTargetIndex(state));
      forwardUrls.push(currentUrl(state));
    }
    expect(forwardUrls).toEqual([...TOOL_ROUTE_SEQUENCE]);
  });
});
