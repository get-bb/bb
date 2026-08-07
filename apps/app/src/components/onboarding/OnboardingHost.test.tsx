// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultAppSettings } from "@bb/domain";
import { OnboardingHost } from "./OnboardingHost";

const testState = vi.hoisted(() => ({
  updateSettings: vi.fn(),
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      generalSettings: {
        ...defaultAppSettings,
        onboardingCompletedAt: null,
      },
    },
  }),
  useHostProviderCliStatus: () => ({ data: undefined }),
}));

vi.mock("@/hooks/mutations/settings-mutations", () => ({
  useUpdateGeneralSettings: () => ({ mutate: testState.updateSettings }),
}));

vi.mock("@/hooks/mutations/project-mutations", () => ({
  useCreateProject: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/queries/host-queries", () => ({
  usePrimaryHost: () => ({ id: "host-1" }),
}));

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => ({ data: { projects: [] } }),
}));

vi.mock("@/components/provider-cli/provider-cli-install", () => ({
  buildProviderCliIssue: vi.fn(),
  hasProviderCliAction: vi.fn(),
  providerCliEntries: vi.fn(() => []),
  useProviderCliInstallRunner: () => ({
    queuedJobKeys: new Set(),
    runningJobKey: null,
    startInstall: vi.fn(),
  }),
}));

vi.mock("@/components/provider-cli/provider-cli-install-store", () => ({
  providerCliJobKey: vi.fn(() => "job"),
}));

vi.mock("@/lib/sdk", () => ({
  sdk: {
    system: {
      onboardingEvent: vi.fn(() => Promise.resolve({ ok: true })),
    },
  },
}));

vi.mock("./OnboardingFlow", () => ({
  OnboardingFlow: ({
    onClose,
  }: {
    onClose: (outcome: {
      completed: boolean;
      step: "agents" | "projects";
      projectsAdded: number;
      agentState: "connected";
    }) => void;
  }) => (
    <button
      onClick={() =>
        onClose({
          completed: true,
          step: "projects",
          projectsAdded: 0,
          agentState: "connected",
        })
      }
      type="button"
    >
      Close onboarding
    </button>
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OnboardingHost", () => {
  it("updates only the onboarding completion timestamp", () => {
    render(<OnboardingHost />);

    fireEvent.click(screen.getByRole("button", { name: "Close onboarding" }));

    expect(testState.updateSettings).toHaveBeenCalledWith({
      onboardingCompletedAt: expect.any(String),
    });
  });
});
