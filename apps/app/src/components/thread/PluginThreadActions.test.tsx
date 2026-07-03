// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import type { PluginThreadActionContribution } from "@/hooks/queries/plugin-contribution-queries";
import { pluginIconName } from "@/components/plugin/PluginIcon";
import {
  resetPluginLogoStoreForTest,
  setPluginLogoUrls,
} from "@/lib/plugin-logos";
import {
  PluginThreadActionButtons,
  PluginThreadActions,
} from "./PluginThreadActions";

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  message: vi.fn(),
}));

vi.mock("@/components/ui/app-toast.js", () => ({
  appToast: mockToast,
}));

const mockContributions = vi.hoisted(() => ({
  data: undefined as { threadActions: PluginThreadActionContribution[] } | undefined,
}));

vi.mock("@/hooks/queries/plugin-contribution-queries", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/hooks/queries/plugin-contribution-queries")
    >();
  return {
    ...actual,
    usePluginContributions: () => mockContributions,
  };
});

function makeAction(
  overrides: Partial<PluginThreadActionContribution> = {},
): PluginThreadActionContribution {
  return {
    pluginId: "linear",
    id: "run-tests",
    title: "Run tests",
    icon: null,
    confirm: null,
    ...overrides,
  };
}

function mockActionFetch(
  body: unknown,
  init: { status?: number; delay?: boolean } = {},
) {
  let resolveResponse: (() => void) | undefined;
  const response = new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
  const fetchMock = vi.fn().mockImplementation(() => {
    if (!init.delay) return Promise.resolve(response);
    return new Promise<Response>((resolve) => {
      resolveResponse = () => {
        resolve(response);
      };
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, release: () => resolveResponse?.() };
}

function renderActions(actions: PluginThreadActionContribution[]) {
  mockContributions.data = { threadActions: actions };
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  return render(
    <Wrapper>
      <PluginThreadActions threadId="thr_1" />
    </Wrapper>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  mockContributions.data = undefined;
});

describe("PluginThreadActions", () => {
  it("renders nothing without contributions", () => {
    const { container } = renderActions([]);
    expect(container.textContent).toBe("");
  });

  it("runs a confirm-less action with a pending state, then shows the returned toast", async () => {
    const { fetchMock, release } = mockActionFetch(
      { ok: true, toast: { kind: "success", message: "Tests requested" } },
      { delay: true },
    );
    renderActions([makeAction()]);

    const button = screen.getByRole("button", {
      name: "Run tests",
    }) as HTMLButtonElement;
    fireEvent.click(button);

    // Pending: the POST is in flight, the button is disabled and busy.
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/plugins/linear/actions/run-tests",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ threadId: "thr_1" }),
        }),
      );
      expect(button.disabled).toBe(true);
      expect(button.getAttribute("aria-busy")).toBe("true");
    });

    release();
    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith("Tests requested");
      expect(button.disabled).toBe(false);
    });
  });

  it("shows a confirm dialog first for confirm-carrying actions and runs on confirm", async () => {
    const { fetchMock } = mockActionFetch({ ok: true });
    renderActions([
      makeAction({ id: "sync", title: "Sync", confirm: "Sync everything?" }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Sync" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Sync everything?")).toBeTruthy();

    // The dialog's footer carries the action-titled confirm button.
    const dialog = screen.getByRole("dialog");
    const confirmButton = Array.from(
      dialog.querySelectorAll("button"),
    ).find((candidate) => candidate.textContent === "Sync");
    if (!confirmButton) throw new Error("confirm button not found");
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/plugins/linear/actions/sync",
        expect.anything(),
      );
    });
  });

  it("does not run when the confirm dialog is cancelled", async () => {
    const { fetchMock } = mockActionFetch({ ok: true });
    renderActions([
      makeAction({ id: "sync", title: "Sync", confirm: "Sync everything?" }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Sync" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows an automatic error toast when the handler fails", async () => {
    mockActionFetch({ ok: false, error: "action boom" }, { status: 500 });
    renderActions([makeAction()]);

    fireEvent.click(screen.getByRole("button", { name: "Run tests" }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        "Run tests failed",
        expect.objectContaining({ description: "action boom" }),
      );
    });
  });
});

describe("PluginThreadActionButtons", () => {
  it("disables every button while one action is pending", () => {
    render(
      <PluginThreadActionButtons
        actions={[makeAction(), makeAction({ id: "sync", title: "Sync" })]}
        pendingActionKey="linear/run-tests"
        onRun={() => {}}
      />,
    );
    expect(
      (screen.getByRole("button", { name: "Run tests" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Sync" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});

describe("pluginIconName", () => {
  it("uses a known icon name and falls back to Zap otherwise", () => {
    expect(pluginIconName("GitBranch")).toBe("GitBranch");
    expect(pluginIconName("beaker")).toBe("Zap");
    expect(pluginIconName(null)).toBe("Zap");
  });
});

describe("plugin logo on thread action buttons", () => {
  afterEach(() => {
    resetPluginLogoStoreForTest();
  });

  it("renders the plugin's logo instead of the bolt when one is served", () => {
    setPluginLogoUrls(
      new Map([
        [
          "linear",
          {
            logoUrl: "/api/v1/plugins/linear/assets/logo?h=abc",
            logoDarkUrl: null,
          },
        ],
      ]),
    );
    render(
      <PluginThreadActionButtons
        actions={[makeAction()]}
        pendingActionKey={null}
        onRun={() => {}}
      />,
    );
    const logo = screen.getByTestId("plugin-logo-linear");
    expect(logo.getAttribute("src")).toBe(
      "/api/v1/plugins/linear/assets/logo?h=abc",
    );
  });

  it("falls back to the named icon without a logo", () => {
    render(
      <PluginThreadActionButtons
        actions={[makeAction()]}
        pendingActionKey={null}
        onRun={() => {}}
      />,
    );
    expect(screen.queryByTestId("plugin-logo-linear")).toBeNull();
    // The generic bolt fallback renders as an svg inside the button.
    const button = screen.getByRole("button", { name: "Run tests" });
    expect(button.querySelector("svg")).not.toBeNull();
  });
});
