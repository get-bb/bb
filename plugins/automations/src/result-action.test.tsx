// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { AutomationResultAction } from "../result-action.js";

const snapshot = {
  repo: "acme/widgets",
  branch: "automation/change",
  commit: "a".repeat(40),
  baseBranch: "main",
  baseCommit: "b".repeat(40),
};
let nextThread = 0;

afterEach(cleanup);

async function showResult(
  publish = vi.fn(async (_input: unknown) => ({
    url: "https://github.com/acme/widgets/pull/7",
  })),
) {
  const threadId = `result-${++nextThread}`;
  const slot = renderSlot(
    { component: AutomationResultAction },
    { threadId, projectId: "project", isCompactViewport: false },
    {
      rpc: {
        automation_result: () => ({
          result: {
            automationId: "automation",
            name: "Fix failing tests",
            inspection: { status: "ready", snapshot },
          },
        }),
        automation_publish: publish,
      },
    },
  );
  const review = await screen.findByRole("button", {
    name: "Review local job result",
  });
  return { slot, review, publish, threadId };
}

it("keeps a result local when it is loaded, reviewed and dismissed without publishing", async () => {
  const { review, publish } = await showResult();
  expect(publish).not.toHaveBeenCalled();
  fireEvent.click(review);
  const body = await screen.findByRole("textbox", {
    name: "Pull request description",
  });
  fireEvent.change(body, { target: { value: "Reviewed test fixes" } });
  fireEvent.click(screen.getByRole("button", { name: "Keep local" }));
  expect(publish).not.toHaveBeenCalled();
});

it("keeps the review available after a rejected click and does not claim a pull request exists", async () => {
  const publish = vi.fn(async (_input: unknown): Promise<{ url: string }> => {
    throw new Error(
      "The local result changed. Review it again before publishing.",
    );
  });
  const { review } = await showResult(publish);
  fireEvent.click(review);
  fireEvent.change(
    await screen.findByRole("textbox", { name: "Pull request description" }),
    { target: { value: "Reviewed fixes" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Push and open draft PR" }),
  );
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Review it again",
  );
  expect(publish).toHaveBeenCalledTimes(1);
  expect(
    screen.queryByRole("link", { name: "Open draft pull request" }),
  ).toBeNull();
  expect(screen.getByRole("button", { name: "Keep local" })).not.toHaveProperty(
    "disabled",
    true,
  );
});

it("sends the displayed snapshot and edited copy only after the publish click", async () => {
  const { review, publish, threadId } = await showResult();
  fireEvent.click(review);
  fireEvent.change(
    await screen.findByRole("textbox", { name: "Pull request title" }),
    { target: { value: "  Fix the test failure  " } },
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: "Pull request description" }),
    { target: { value: "Reviewed the local diff and test result." } },
  );
  expect(screen.getByText(/Commit aaaaaaaaaaaa/)).toBeTruthy();
  expect(publish).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Push and open draft PR" }),
  );
  await waitFor(() =>
    expect(publish).toHaveBeenCalledWith({
      threadId,
      snapshot,
      title: "Fix the test failure",
      body: "Reviewed the local diff and test result.",
    }),
  );
  expect(
    (
      await screen.findByRole("link", { name: "Open draft pull request" })
    ).getAttribute("href"),
  ).toBe("https://github.com/acme/widgets/pull/7");
});
