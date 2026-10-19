// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { defaultAppSettings, type AppSettings } from "@bb/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingGate } from "./OnboardingGate";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  useSystemConfig: vi.fn(),
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: mocks.useSystemConfig,
}));
vi.mock("@/hooks/mutations/settings-mutations", () => ({
  useUpdateGeneralSettings: () => ({ mutate: mocks.mutate }),
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
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OnboardingGate", () => {
  it("shows the setup guide instead of the app on a server that has never been set up", async () => {
    configWith({ onboardingCompletedAt: null });

    renderGate();

    expect(await screen.findByText("Setup guide at agent")).toBeTruthy();
    expect(screen.queryByText("App shell")).toBeNull();
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

    fireEvent.click(await screen.findByText("Setup guide at agent"));

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

  it("shows the guide again when the completion time is cleared after a close in the same session", async () => {
    configWith({ onboardingCompletedAt: null });
    const { view } = renderGate();
    fireEvent.click(await screen.findByText("Setup guide at agent"));

    configWith({ onboardingCompletedAt: COMPLETED_AT });
    view.rerender(
      <OnboardingGate>
        <div>App shell</div>
      </OnboardingGate>,
    );
    expect(screen.getByText("App shell")).toBeTruthy();

    configWith({ onboardingCompletedAt: null });
    view.rerender(
      <OnboardingGate>
        <div>App shell</div>
      </OnboardingGate>,
    );

    expect(await screen.findByText("Setup guide at agent")).toBeTruthy();
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

  it("falls back to the app when settings cannot be loaded", () => {
    mocks.useSystemConfig.mockReturnValue({ data: undefined, isError: true });

    renderGate();

    expect(screen.getByText("App shell")).toBeTruthy();
  });
});
