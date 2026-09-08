// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { MachineAccessSettings } from "./MachineAccessSettings";

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: makeSystemConfig({
      serverAccess: {
        providers: [
          {
            id: "connect",
            displayName: "bb Cloud",
            availability: { status: "available" },
            attention: "2 legacy access records need attention",
          },
        ],
        defaultProviderId: "connect",
        effectiveUrl: null,
        urlSource: null,
      },
    }),
  }),
}));
vi.mock("@/hooks/mutations/settings-mutations", () => ({
  useUpdateGeneralSettings: () => ({ isPending: false }),
}));
afterEach(cleanup);
it("shows access attention in Machines settings even when automatic access is available", () => {
  render(<MachineAccessSettings />);
  expect(screen.getByRole("status").textContent).toBe(
    "bb Cloud: 2 legacy access records need attention",
  );
  expect(screen.getByText(/Currently: bb Cloud/)).toBeTruthy();
});
