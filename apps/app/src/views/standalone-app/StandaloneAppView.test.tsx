// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
  applicationId: "app_status",
  name: "Review Board",
  entry: { path: "index.html", kind: "html" },
  capabilities: ["data", "message"],
  icon: { kind: "builtin", name: "ListTodo" },
  appsRootPath: "/tmp/bb-data/apps",
  appRootPath: "/tmp/bb-data/apps/app_status",
  appDataPath: "/tmp/bb-data/apps/app_status/data",
};

function renderStandaloneApp(applicationId: string) {
  const { wrapper } = createQueryClientTestHarness();
  return render(
    <MemoryRouter initialEntries={[`/apps/${applicationId}`]}>
      <Routes>
        <Route path={STANDALONE_APP_ROUTE_PATH} element={<StandaloneAppView />} />
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

    renderStandaloneApp("app_status");

    const frame = await screen.findByTitle("Review Board");
    // No targetThreadId on the standalone surface — the app renders without a
    // host thread.
    expect(frame.getAttribute("src")).toMatch(
      /^\/api\/v1\/apps\/app_status\/\?v=\d+$/u,
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

    renderStandaloneApp("app_gone");

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

    renderStandaloneApp("app_broken");

    expect(
      await screen.findByText("This app's manifest is invalid."),
    ).toBeTruthy();
  });
});
