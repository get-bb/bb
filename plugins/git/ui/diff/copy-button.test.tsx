// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { GitDiffCopyButton } from "@bb/shared-ui/git-diff/renderers";

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("shows core's copy failure toast when the clipboard write fails", async () => {
  renderSlot(
    { component: GitDiffCopyButton },
    { text: "src/a.ts", label: "Copy path for a.ts" },
    { experimental_copyToClipboard: async () => false },
  );
  fireEvent.click(screen.getByRole("button", { name: "Copy path for a.ts" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to copy"));
  expect(toast.success).not.toHaveBeenCalled();
});
