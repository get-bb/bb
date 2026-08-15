// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { defaultAppSettings, defaultExperiments } from "@bb/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingHost } from "./OnboardingHost";

const mocks = vi.hoisted(() => ({
  useCreateProject: vi.fn(),
  useHostProviderCliStatus: vi.fn(),
  usePrimaryHost: vi.fn(),
  useProviderCliInstallRunner: vi.fn(),
  useSidebarNavigation: vi.fn(),
  useSystemConfig: vi.fn(),
  useUpdateGeneralSettings: vi.fn(),
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useHostProviderCliStatus: mocks.useHostProviderCliStatus,
  useSystemConfig: mocks.useSystemConfig,
}));
vi.mock("@/hooks/mutations/settings-mutations", () => ({
  useUpdateGeneralSettings: mocks.useUpdateGeneralSettings,
}));
vi.mock("@/hooks/mutations/project-mutations", () => ({
  useCreateProject: mocks.useCreateProject,
}));
vi.mock("@/hooks/queries/host-queries", () => ({
  usePrimaryHost: mocks.usePrimaryHost,
}));
vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: mocks.useSidebarNavigation,
}));
vi.mock("@/components/provider-cli/provider-cli-install", () => ({
  buildProviderCliIssue: vi.fn(),
  hasProviderCliAction: vi.fn(),
  providerCliEntries: vi.fn(() => []),
  useProviderCliInstallRunner: mocks.useProviderCliInstallRunner,
}));
vi.mock("@/components/provider-cli/provider-cli-install-store", () => ({
  providerCliJobKey: vi.fn(() => "job"),
}));
vi.mock("./OnboardingFlow", () => ({
  OnboardingFlow: () => <div>Onboarding flow</div>,
}));

beforeEach(() => {
  mocks.useCreateProject.mockReturnValue({ mutateAsync: vi.fn() });
  mocks.useHostProviderCliStatus.mockReturnValue({ data: undefined });
  mocks.usePrimaryHost.mockReturnValue({ id: "host-1" });
  mocks.useProviderCliInstallRunner.mockReturnValue({
    failuresByJobKey: new Map(),
    queuedJobKeys: new Set(),
    runningJobKey: null,
    startInstall: vi.fn(),
  });
  mocks.useSidebarNavigation.mockReturnValue({ data: { projects: [] } });
  mocks.useUpdateGeneralSettings.mockReturnValue({ mutate: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OnboardingHost", () => {
  it("does not show or run provider checks while the experiment is off", () => {
    mocks.useSystemConfig.mockReturnValue({
      data: {
        experiments: defaultExperiments,
        generalSettings: defaultAppSettings,
      },
    });

    render(<OnboardingHost />);

    expect(screen.queryByText("Onboarding flow")).toBeNull();
    expect(mocks.useHostProviderCliStatus).toHaveBeenCalledWith({
      enabled: false,
      hostId: "host-1",
    });
  });

  it("shows onboarding when the experiment is on and setup is incomplete", () => {
    mocks.useSystemConfig.mockReturnValue({
      data: {
        experiments: { ...defaultExperiments, newOnboarding: true },
        generalSettings: defaultAppSettings,
      },
    });

    render(<OnboardingHost />);

    expect(screen.getByText("Onboarding flow")).toBeTruthy();
    expect(mocks.useHostProviderCliStatus).toHaveBeenCalledWith({
      enabled: true,
      hostId: "host-1",
    });
  });
});
