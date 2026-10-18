// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { createDeferredPromise } from "@bb/test-helpers";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPromptDraftAccessor } from "@/hooks/usePromptDraftStorage";
import { useRootComposeProjectId } from "@/lib/root-compose-selection";
import { useOnboardingProjectImport } from "./useOnboardingProjectImport";

const createProject = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/mutations/project-mutations", () => ({
  useCreateProject: () => ({ mutateAsync: createProject }),
}));

const repos = [
  { name: "atlas-web", path: "/repos/atlas-web" },
  { name: "atlas-api", path: "/repos/atlas-api" },
  { name: "docs-site", path: "/repos/docs-site" },
];
const draft = getPromptDraftAccessor({ kind: "new-thread" });

function arrange(entry: "first_run" | "replay" = "first_run") {
  const store = createStore();
  const onContinue = vi.fn();
  const onSettled = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const view = renderHook(
    () => ({
      ...useOnboardingProjectImport({ entry, onContinue, onSettled }),
      selection: useRootComposeProjectId(),
    }),
    { wrapper },
  );
  return { ...view, onContinue, onSettled, wrapper };
}

beforeEach(() => {
  draft.clear();
  window.localStorage.clear();
  window.sessionStorage.clear();
  createProject.mockReset();
  createProject.mockImplementation(async ({ name }: { name: string }) => ({
    id: `proj_${name}`,
  }));
});

afterEach(() => {
  cleanup();
  draft.clear();
});

describe("onboarding project imports", () => {
  it.each([
    [0, PERSONAL_PROJECT_ID],
    [1, "proj_atlas-web"],
    [3, "proj_docs-site"],
  ])(
    "selects the last successful project from %i imports",
    async (count, expected) => {
      const view = arrange();
      await act(() =>
        view.result.current.importProjects("host_local", repos.slice(0, count)),
      );
      expect(view.result.current.selection[0]).toBe(expected);
      expect(view.onContinue).toHaveBeenCalledOnce();
    },
  );

  it.each(["proj_existing", PERSONAL_PROJECT_ID])(
    "preserves the returning choice %s",
    async (selected) => {
      window.localStorage.setItem("bb.root-compose.project-id", selected);
      const view = arrange();
      await act(() => view.result.current.importProjects("host_local", repos));
      expect(view.result.current.selection[0]).toBe(selected);
    },
  );

  it("does not preselect imports when the setup guide is replayed", async () => {
    const view = arrange("replay");
    await act(() => view.result.current.importProjects("host_local", repos));
    expect(view.result.current.selection[0]).toBe(PERSONAL_PROJECT_ID);
  });

  it.each(["close", "choice", "draft"] as const)(
    "ignores a delayed import after %s",
    async (interruption) => {
      const pending = createDeferredPromise<{ id: string }>();
      createProject.mockReturnValueOnce(pending.promise);
      const view = arrange();
      let imported: Promise<void>;
      act(() => {
        imported = view.result.current.importProjects("host_local", repos);
      });
      act(() => {
        if (interruption === "close") view.unmount();
        if (interruption === "choice")
          view.result.current.selection[1](PERSONAL_PROJECT_ID);
        if (interruption === "draft") {
          draft.setTextAndMentions("Keep this draft here", []);
          draft.clear();
        }
      });
      await act(async () => {
        pending.resolve({ id: "proj_atlas-web" });
        await imported;
      });
      const selection = renderHook(useRootComposeProjectId, {
        wrapper: view.wrapper,
      });
      expect(selection.result.current[0]).toBe(PERSONAL_PROJECT_ID);
      if (interruption === "close") {
        expect(view.onContinue).not.toHaveBeenCalled();
        expect(createProject).toHaveBeenCalledOnce();
      }
    },
  );

  it("retains successful imports and selects the last successful retry", async () => {
    createProject
      .mockResolvedValueOnce({ id: "proj_atlas-web" })
      .mockRejectedValueOnce(new Error("Import failed"));
    const view = arrange();
    await act(() => view.result.current.importProjects("host_local", repos));
    expect(view.result.current.selection[0]).toBe("proj_atlas-web");
    expect(view.onContinue).not.toHaveBeenCalled();
    await act(() =>
      view.result.current.importProjects("host_local", repos.slice(1)),
    );
    expect(view.result.current.selection[0]).toBe("proj_docs-site");
    expect(view.onContinue).toHaveBeenCalledOnce();
  });

  it("keeps an explicit selection of the imported project during a retry", async () => {
    createProject
      .mockResolvedValueOnce({ id: "proj_atlas-web" })
      .mockRejectedValueOnce(new Error("Import failed"));
    const view = arrange();
    await act(() => view.result.current.importProjects("host_local", repos));
    act(() => view.result.current.selection[1]("proj_atlas-web"));
    await act(() =>
      view.result.current.importProjects("host_local", repos.slice(1)),
    );
    expect(view.result.current.selection[0]).toBe("proj_atlas-web");
  });
});
