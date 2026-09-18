// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  hasSingleUseRootComposeTargetState,
  shouldStartComposingFromLocationState,
} from "@/views/RootComposeView";
import { useCreateThreadInEnvironment } from "./useCreateThreadInEnvironment";

const navigate = vi.fn();

vi.mock("@/components/ui/app-route-anchor", () => ({
  useRouteNavigate: () => navigate,
}));

vi.mock("@/lib/root-compose-selection", () => ({
  useSetRootComposeProjectId: () => vi.fn(),
}));

describe("useCreateThreadInEnvironment", () => {
  it("navigates with state that opens the composer and seeds the environment", () => {
    navigate.mockClear();
    const { result } = renderHook(() =>
      useCreateThreadInEnvironment({
        projectId: "proj_personal",
        environmentId: "env_1",
      }),
    );

    result.current();

    const state = navigate.mock.calls[0][1].state;
    expect(shouldStartComposingFromLocationState(state)).toBe(true);
    expect(hasSingleUseRootComposeTargetState(state)).toBe(true);
  });
});
