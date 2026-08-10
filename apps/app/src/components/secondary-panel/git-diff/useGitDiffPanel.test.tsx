// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider as JotaiProvider } from "jotai";
import { useEffect, useRef, useState } from "react";
import { expect, it, vi } from "vitest";
import { shouldSyncSelectedMergeBaseBranch } from "./useEnvironmentMergeBase";
import { useGitDiffPanel } from "./useGitDiffPanel";

const requestedBranches = vi.hoisted(
  () => new Map<string, string | undefined>(),
);

vi.mock("../../../hooks/queries/environment-queries", () => ({
  useEnvironmentMergeBaseBranches: (
    environmentId: string,
    options?: { selectedBranch?: string },
  ) => {
    requestedBranches.set(environmentId, options?.selectedBranch);
    return { data: undefined, isFetching: false };
  },
}));

const noop = () => undefined;

function MergeBaseOwner({
  environmentId,
  persistedBranch,
}: {
  environmentId: string;
  persistedBranch: string;
}) {
  const stateKeyRef = useRef<string | undefined>(undefined);
  const syncCountRef = useRef(0);
  const { selectedMergeBaseBranch, setSelectedMergeBaseBranch } =
    useGitDiffPanel({
      activeSecondaryTab: null,
      clearActiveFileTabs: noop,
      environmentId,
      mergeBaseBranchOptionsEnabled: true,
      setThreadSecondaryPanel: noop,
    });

  useEffect(() => {
    if (
      !shouldSyncSelectedMergeBaseBranch({
        previousStateKey: stateKeyRef.current,
        nextStateKey: environmentId,
        persistedMergeBaseBranch: persistedBranch,
        selectedMergeBaseBranch,
        updatePending: false,
      })
    ) {
      return;
    }
    syncCountRef.current += 1;
    if (syncCountRef.current > 10) {
      throw new Error("Merge-base owner did not settle independently");
    }
    stateKeyRef.current = environmentId;
    setSelectedMergeBaseBranch(persistedBranch);
  }, [
    environmentId,
    persistedBranch,
    selectedMergeBaseBranch,
    setSelectedMergeBaseBranch,
  ]);

  return (
    <output data-testid={environmentId}>
      {selectedMergeBaseBranch ?? "unset"}
    </output>
  );
}

function TwoOwnerHarness() {
  const [leftBranch, setLeftBranch] = useState("main");
  return (
    <JotaiProvider>
      <MergeBaseOwner environmentId="env-left" persistedBranch={leftBranch} />
      <MergeBaseOwner environmentId="env-right" persistedBranch="release" />
      <button type="button" onClick={() => setLeftBranch("feature-left")}>
        Change left branch
      </button>
    </JotaiProvider>
  );
}

it("keeps simultaneous merge-base owners and queries independent", async () => {
  requestedBranches.clear();
  render(<TwoOwnerHarness />);

  await waitFor(() => {
    expect(screen.getByTestId("env-left").textContent).toBe("main");
    expect(screen.getByTestId("env-right").textContent).toBe("release");
  });
  expect(requestedBranches.get("env-left")).toBe("main");
  expect(requestedBranches.get("env-right")).toBe("release");

  fireEvent.click(screen.getByRole("button", { name: "Change left branch" }));

  await waitFor(() => {
    expect(screen.getByTestId("env-left").textContent).toBe("feature-left");
    expect(requestedBranches.get("env-left")).toBe("feature-left");
  });
  expect(screen.getByTestId("env-right").textContent).toBe("release");
  expect(requestedBranches.get("env-right")).toBe("release");
});
