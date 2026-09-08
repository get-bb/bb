// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RecipeEditor } from "./recipe-editor.js";
import { stalenessLabel } from "./ui-state.js";

afterEach(cleanup);

it("preserves a conflicting draft and its revision until explicitly reloaded", async () => {
  const save = vi
    .fn()
    .mockRejectedValue(new Error("Revision conflict: latest revision 2"));
  const view = render(
    <RecipeEditor
      projectId="p1"
      recipe={null}
      save={save}
      reload={vi.fn()}
      saved={vi.fn()}
      dirtyChanged={vi.fn()}
    />,
  );
  fireEvent.change(view.getByLabelText("Dockerfile recipe"), {
    target: { value: "RUN npm --version\n" },
  });
  fireEvent.click(view.getByText("Save recipe"));
  await view.findByRole("alert");
  expect(view.getByRole("alert").textContent).toContain("Your draft is kept");
  expect(view.container.querySelector("textarea")?.value).toBe(
    "RUN npm --version\n",
  );
  fireEvent.click(view.getByText("Save recipe"));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls.map((call) => call[0].expectedRevision)).toEqual([
    0, 0,
  ]);
});

it("never presents an unchecked source as fresh and combines changed inputs", () => {
  const state = {
    dockerfileChanged: false,
    lockfilesChanged: null,
    reason: null,
    lastCheckedAt: null,
  };
  expect(stalenessLabel(state)).toBe("Source not checked");
  expect(
    stalenessLabel({
      ...state,
      dockerfileChanged: true,
      lockfilesChanged: true,
    }),
  ).toContain("Dockerfile and lockfiles changed");
  expect(stalenessLabel({ ...state, lockfilesChanged: false })).toContain(
    "match the recorded build",
  );
});
