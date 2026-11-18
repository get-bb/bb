// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { defaultAppSettings, type AppSettings } from "@bb/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingGate } from "./OnboardingGate";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  useSystemConfig: vi.fn(),
  useHostProviderCliStatus: vi.fn(),
  usePrimaryHost: vi.fn(),
  markScreenPainted: vi.fn(),
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: mocks.useSystemConfig,
  useHostProviderCliStatus: mocks.useHostProviderCliStatus,
}));
vi.mock("@/hooks/queries/host-queries", () => ({
  usePrimaryHost: mocks.usePrimaryHost,
}));
vi.mock("@/hooks/mutations/settings-mutations", () => ({
  useUpdateGeneralSettings: () => ({ mutate: mocks.mutate }),
}));
vi.mock("@/lib/screen-paint", () => ({
  markScreenPainted: mocks.markScreenPainted,
}));
vi.mock("./OnboardingFlow", () => ({
  OnboardingFlow: ({
    initialStep,
    onClose,
  }: {
    initialStep: string;
    onClose: () => void;
  }) => (
    <button type="button" onClick={onClose}>
      Setup guide at {initialStep}
    </button>
  ),
}));

const COMPLETED_AT = "2026-10-01T00:00:00.000Z";

function configWith(settings: Partial<AppSettings>) {
  mocks.useSystemConfig.mockReturnValue({
    data: { generalSettings: { ...defaultAppSettings, ...settings } },
    isError: false,
  });
}

function renderGate() {
  const view = render(
    <OnboardingGate>
      <div>App shell</div>
    </OnboardingGate>,
  );
  return { view };
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.usePrimaryHost.mockReturnValue({ id: "host-1" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OnboardingGate", () => {
  it("shows the setup guide instead of the app on a server that has never been set up", async () => {
    configWith({ onboardingCompletedAt: null });

    renderGate();

    expect(await screen.findByText(/Setup guide at agent/u)).toBeTruthy();
    expect(screen.queryByText("App shell")).toBeNull();
  });

  it("signals that the screen painted once the setup guide shows, though the app behind it never renders", async () => {
    configWith({ onboardingCompletedAt: null });

    renderGate();

    expect(await screen.findByText(/Setup guide at agent/u)).toBeTruthy();
    await vi.waitFor(() => {
      expect(mocks.markScreenPainted).toHaveBeenCalled();
    });
  });

  it("renders the app untouched once setup has been finished", () => {
    configWith({ onboardingCompletedAt: COMPLETED_AT });

    renderGate();

    expect(screen.getByText("App shell")).toBeTruthy();
    expect(screen.queryByText(/Setup guide/u)).toBeNull();
  });

  it("records completion and reveals the app when first-run setup closes", async () => {
    configWith({ onboardingCompletedAt: null, streamerMode: true });
    renderGate();

    fireEvent.click(await screen.findByText(/Setup guide at agent/u));

    expect(screen.getByText("App shell")).toBeTruthy();
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    const written = mocks.mutate.mock.calls[0]?.[0] as AppSettings;
    expect(written).toMatchObject({
      streamerMode: true,
    });
    expect(Number.isNaN(Date.parse(written.onboardingCompletedAt ?? ""))).toBe(
      false,
    );
  });

  it("holds a first-time browser blank until settings load, but boots a returning browser straight into the app", () => {
    mocks.useSystemConfig.mockReturnValue({ data: undefined, isError: false });
    const first = renderGate();
    expect(screen.queryByText("App shell")).toBeNull();
    first.view.unmount();

    configWith({ onboardingCompletedAt: COMPLETED_AT });
    const loaded = renderGate();
    loaded.view.unmount();

    mocks.useSystemConfig.mockReturnValue({ data: undefined, isError: false });
    renderGate();
    expect(screen.getByText("App shell")).toBeTruthy();
  });

  it("stops holding the screen blank once a settings request has failed", () => {
    mocks.useSystemConfig.mockReturnValue({
      data: undefined,
      isError: false,
      failureCount: 1,
    });

    renderGate();

    expect(screen.getByText("App shell")).toBeTruthy();
  });

  it("starts loading agent install info only while setup is unfinished", () => {
    configWith({ onboardingCompletedAt: null });
    const { view } = renderGate();
    expect(mocks.useHostProviderCliStatus).toHaveBeenLastCalledWith({
      hostId: "host-1",
      enabled: true,
    });

    configWith({ onboardingCompletedAt: COMPLETED_AT });
    view.rerender(
      <OnboardingGate>
        <div>App shell</div>
      </OnboardingGate>,
    );
    expect(mocks.useHostProviderCliStatus).toHaveBeenLastCalledWith({
      hostId: "host-1",
      enabled: false,
    });
  });

  it("falls back to the app when settings cannot be loaded", () => {
    mocks.useSystemConfig.mockReturnValue({ data: undefined, isError: true });

    renderGate();

    expect(screen.getByText("App shell")).toBeTruthy();
  });
});
