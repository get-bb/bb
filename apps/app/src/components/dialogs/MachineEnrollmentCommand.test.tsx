// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { MachineEnrollmentCommand } from "./MachineEnrollmentCommand";

vi.mock("@/lib/sdk", () => ({
  sdk: { hosts: { experimental_enrollmentCommand: vi.fn() } },
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("discards the private command when the server settles enrollment", async () => {
  vi.mocked(sdk.hosts.experimental_enrollmentCommand)
    .mockResolvedValueOnce({
      command: "bb machine enroll --bootstrap-env PRIVATE_BUNDLE",
    })
    .mockResolvedValue({ command: null });
  render(<MachineEnrollmentCommand id="manual-launch" scope="launch" />);
  expect(
    await screen.findByText("bb machine enroll --bootstrap-env PRIVATE_BUNDLE"),
  ).toBeTruthy();
  await waitFor(
    () =>
      expect(
        screen.queryByText("bb machine enroll --bootstrap-env PRIVATE_BUNDLE"),
      ).toBeNull(),
    { timeout: 3000 },
  );
  expect(screen.queryByRole("button", { name: "Copy command" })).toBeNull();
});

it("aborts retrieval when the follower closes", async () => {
  let signal: AbortSignal | undefined;
  vi.mocked(sdk.hosts.experimental_enrollmentCommand).mockImplementation(
    async (args) => {
      signal = args.signal;
      return new Promise(() => {});
    },
  );
  const view = render(
    <MachineEnrollmentCommand id="manual-launch" scope="launch" />,
  );
  expect(signal?.aborted).toBe(false);
  view.unmount();
  expect(signal?.aborted).toBe(true);
});
