// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import type { AppDetail } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { HttpError } from "@/lib/api";
import { STANDALONE_APP_ROUTE_PATH } from "@/lib/app-route-paths";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { StandaloneAppView } from "./StandaloneAppView";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();

  return {
    ...actual,
    getApp: vi.fn(),
    getAppMarkdownPreview: vi.fn(),
  };
});

const HTML_APP: AppDetail = {
  applicationId: "status",
  name: "Review Board",
  entry: { path: "index.html", kind: "html" },
  capabilities: ["data", "message"],
  icon: { kind: "builtin", name: "ListTodo" },
  source: null,
  appsRootPath: "/tmp/bb-data/apps",
  appRootPath: "/tmp/bb-data/apps/status",
  appDataPath: "/tmp/bb-data/apps/status/data",
};

function renderStandaloneApp(applicationId: string) {
  const { wrapper } = createQueryClientTestHarness();
  return render(
    <MemoryRouter initialEntries={[`/apps/${applicationId}`]}>
      <Routes>
        <Route
          path={STANDALONE_APP_ROUTE_PATH}
          element={<StandaloneAppView />}
        />
      </Routes>
    </MemoryRouter>,
    { wrapper },
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StandaloneAppView", () => {
  it("renders the app surface in a thread-independent iframe", async () => {
    vi.mocked(api.getApp).mockResolvedValue(HTML_APP);

    renderStandaloneApp("status");

    const frame = await screen.findByTitle("Review Board");
    // No targetThreadId on the standalone surface — the app renders without a
    // host thread.
    expect(frame.getAttribute("src")).toMatch(
      /^\/api\/v1\/apps\/status\/\?v=\d+$/u,
    );
  });

  it("shows a clean not-found state when the app is missing", async () => {
    vi.mocked(api.getApp).mockRejectedValue(
      new HttpError({
        status: 404,
        code: "app_missing",
        message: "App not found",
      }),
    );

    renderStandaloneApp("gone");

    expect(await screen.findByText("App not found.")).toBeTruthy();
  });

  it("surfaces an invalid manifest error", async () => {
    vi.mocked(api.getApp).mockRejectedValue(
      new HttpError({
        status: 422,
        code: "invalid_manifest",
        message: "App manifest failed validation.",
      }),
    );

    renderStandaloneApp("broken");

    expect(
      await screen.findByText("This app's manifest is invalid."),
    ).toBeTruthy();
  });

  it("keeps visited apps mounted so switching app pages reuses their iframes", async () => {
    vi.mocked(api.getApp).mockImplementation((applicationId) =>
      Promise.resolve(applicationId === "status" ? HTML_APP : PORTFOLIO_APP),
    );
    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/apps/status"]}>
        <Routes>
          <Route
            path={STANDALONE_APP_ROUTE_PATH}
            element={
              <>
                <StandaloneAppView />
                <AppPageNavButton applicationId="status" />
                <AppPageNavButton applicationId="portfolio" />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
      { wrapper },
    );

    const statusFrame = await screen.findByTitle("Review Board");

    fireEvent.click(screen.getByRole("button", { name: "go-portfolio" }));
    const portfolioFrame = await screen.findByTitle("Paper Portfolio");

    // The previous app stays mounted in a hidden deck entry — same iframe
    // element, so its document and state survive the switch.
    expect(screen.getByTitle("Review Board")).toBe(statusFrame);
    expect(statusFrame.closest(".hidden")).not.toBeNull();
    expect(portfolioFrame.closest(".hidden")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "go-status" }));

    // Switching back is a visibility toggle, not a destroy/recreate.
    expect(screen.getByTitle("Review Board")).toBe(statusFrame);
    expect(statusFrame.closest(".hidden")).toBeNull();
    expect(portfolioFrame.closest(".hidden")).not.toBeNull();
  });
});

const PORTFOLIO_APP: AppDetail = {
  ...HTML_APP,
  applicationId: "portfolio",
  name: "Paper Portfolio",
  appRootPath: "/tmp/bb-data/apps/portfolio",
  appDataPath: "/tmp/bb-data/apps/portfolio/data",
};

function AppPageNavButton({ applicationId }: { applicationId: string }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => void navigate(`/apps/${applicationId}`)}
    >
      {`go-${applicationId}`}
    </button>
  );
}
