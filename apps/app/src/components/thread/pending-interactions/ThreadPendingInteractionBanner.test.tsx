// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { PendingInteraction, PluginPendingInteraction } from "@bb/domain";
import type { PluginPendingInteractionProps } from "@get-bb/plugin-sdk";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  type PluginRegistrationSet,
} from "@/lib/plugin-slots";
import {
  resetPluginLogoStoreForTest,
  setPluginLogoUrls,
} from "@/lib/plugin-logos";
import { resetAllCrashedPluginSlotsForTest } from "../../plugin/PluginSlotMount";
import { ThreadPendingInteractionBanner } from "./ThreadPendingInteractionBanner";

const mocks = vi.hoisted(() => ({
  resolveMutateAsync: vi.fn(async () => ({})),
  stopMutateAsync: vi.fn(async () => undefined),
}));

vi.mock(
  "@/hooks/mutations/thread-runtime-mutations",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/hooks/mutations/thread-runtime-mutations")
    >()),
    useStopThread: () => ({
      mutateAsync: mocks.stopMutateAsync,
      mutate: mocks.stopMutateAsync,
      isPending: false,
    }),
  }),
);

vi.mock("@/hooks/mutations/thread-interaction-mutations", () => ({
  useResolveThreadPendingInteraction: () => ({
    mutateAsync: mocks.resolveMutateAsync,
    isPending: false,
    error: null,
  }),
}));

vi.mock("@/lib/sdk", () => ({
  sdk: { threads: { interactions: { respond: vi.fn(), cancel: vi.fn() } } },
}));

const planReview: PendingInteraction = {
  id: "pint_plan",
  threadId: "thr_1",
  turnId: "turn_1",
  providerId: "claude-code",
  providerThreadId: "pt_1",
  providerRequestId: "req_1",
  status: "pending",
  statusReason: null,
  createdAt: 1,
  resolvedAt: null,
  resolution: null,
  payload: {
    kind: "approval",
    reason: null,
    availableDecisions: ["allow_once", "deny"],
    subject: {
      kind: "plan",
      itemId: "plan-1",
      plan: "# Migrate the picker\n\n1. Read labels from the declaration",
      planFilePath: "/tmp/plans/picker.md",
    },
  },
};

const toolUseApproval: PendingInteraction = {
  ...planReview,
  id: "pint_tool",
  providerId: "acp",
  payload: {
    kind: "approval",
    reason: null,
    availableDecisions: ["allow_once", "allow_for_session", "deny"],
    subject: {
      kind: "tool_use",
      itemId: "call_1",
      tool: "mcp__github__create_issue",
      presentation: {
        label: { pending: "Creating issue", completed: "Created issue" },
        icon: { glyph: "Globe" },
        title: "get-bb/bb#42",
        detail: "Opens a **bug** issue",
        tint: { light: "#123456", dark: "#abcdef" },
      },
    },
  },
};

const providerPluginRequest: PendingInteraction = {
  ...planReview,
  id: "pint_provider_request",
  providerId: "acp-cursor",
  resolution: null,
  payload: {
    kind: "secrets/secret-request",
    title: "Add a token",
    data: { fields: ["TOKEN"] },
  },
};

const pluginRequest: PluginPendingInteraction = {
  id: "pint_plugin",
  threadId: "thr_1",
  turnId: null,
  origin: { kind: "plugin", pluginId: "secrets", rendererId: "secret-request" },
  status: "pending",
  statusReason: null,
  createdAt: 1,
  expiresAt: null,
  resolvedAt: null,
  resolution: null,
  payload: { kind: "plugin", title: "Add secrets", data: { fields: ["KEY"] } },
};

function registrationSet(
  overrides: Partial<PluginRegistrationSet>,
): PluginRegistrationSet {
  return {
    homepageSections: [],
    settingsSections: [],
    navPanels: [],
    threadPanelActions: [],
    sidebarFooterActions: [],
    fileOpeners: [],
    messageDirectives: [],
    ...overrides,
  };
}

function renderBanner(interaction: PendingInteraction) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ThreadPendingInteractionBanner
          interaction={interaction}
          threadId="thr_1"
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetPluginLogoStoreForTest();
  resetAllCrashedPluginSlotsForTest();
  mocks.resolveMutateAsync.mockClear();
  mocks.stopMutateAsync.mockClear();
});

describe("ThreadPendingInteractionBanner tool-use approval", () => {
  it("renders the ask from the subject's presentation with the permission decisions", () => {
    renderBanner(toolUseApproval);
    expect(screen.getByText("Creating issue")).toBeTruthy();
    const ask = screen.getByTestId("tool-use-ask");
    expect(ask.textContent).toContain("get-bb/bb#42");
    expect(ask.textContent).toContain("Tool: mcp__github__create_issue");
    expect(ask.querySelector("strong")?.textContent).toBe("bug");
    expect(ask.querySelector("svg")?.getAttribute("style")).toMatch(
      /light-dark\(rgb\(18, 52, 86\), rgb\(171, 205, 239\)\)/,
    );
    fireEvent.click(screen.getByRole("button", { name: "Allow for session" }));
    expect(mocks.resolveMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        interactionId: "pint_tool",
        resolution: { decision: "allow_for_session", grantedPermissions: null },
      }),
    );
  });

  it("draws a plugin-declared icon as a tinted mask when the inventory has it, else the per-kind glyph with no mask", () => {
    const namespacedAsk: PendingInteraction = {
      ...toolUseApproval,
      payload: {
        ...toolUseApproval.payload,
        subject: {
          kind: "tool_use",
          itemId: "call_receipt",
          tool: "echo_stamp",
          presentation: {
            label: { pending: "Writing receipt", completed: "Wrote receipt" },
            icon: { glyph: "echo-provider/receipt" },
            tint: { light: "#123456", dark: "#abcdef" },
          },
        },
      },
    };
    const iconUrl =
      "/api/v1/plugins/echo-provider/assets/icons/receipt.svg?h=abc";
    setPluginLogoUrls(
      new Map([
        [
          "echo-provider",
          {
            displayName: "Echo provider",
            icon: "Zap",
            compactIconUrl: null,
            logoUrl: null,
            logoDarkUrl: null,
            icons: new Map([["receipt", iconUrl]]),
          },
        ],
      ]),
    );
    const withIcon = renderBanner(namespacedAsk);
    const ask = screen.getByTestId("tool-use-ask");
    const mask = ask.querySelector(`[data-plugin-icon-asset="${iconUrl}"]`);
    expect(mask).not.toBeNull();
    expect(mask?.getAttribute("style")).toMatch(
      /light-dark\(rgb\(18, 52, 86\), rgb\(171, 205, 239\)\)/,
    );
    expect(ask.querySelector("[data-icon]")).toBeNull();
    withIcon.unmount();

    resetPluginLogoStoreForTest();
    renderBanner(namespacedAsk);
    const fallback = screen.getByTestId("tool-use-ask");
    expect(fallback.querySelector("[data-plugin-icon-asset]")).toBeNull();
    expect(fallback.querySelector("svg")?.getAttribute("data-icon")).toBe(
      "Terminal",
    );
  });
});

describe("ThreadPendingInteractionBanner request family", () => {
  it("renders a plan review as a request with plan-verdict actions, resolved through today's approval", () => {
    renderBanner(planReview);
    expect(screen.getByText("Ready to code?")).toBeTruthy();
    expect(screen.getByTestId("plan-review-request").textContent).toContain(
      "Read labels from the declaration",
    );
    expect(screen.getByText("/tmp/plans/picker.md")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Allow once" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Approve plan" }));
    expect(mocks.resolveMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thr_1",
        interactionId: "pint_plan",
        resolution: expect.objectContaining({ decision: "allow_once" }),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Keep planning" }));
    expect(mocks.resolveMutateAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({
        resolution: expect.objectContaining({ decision: "deny" }),
      }),
    );
  });

  it("renders a plugin request through the plugin's pendingInteraction slot, keyed by <pluginId>/<kind>", () => {
    function SecretForm({ interaction }: PluginPendingInteractionProps) {
      return <div data-testid="secret-form">{interaction.title}</div>;
    }
    setPluginSlotRegistrations(
      "secrets",
      registrationSet({
        pendingInteractions: [{ id: "secret-request", component: SecretForm }],
      }),
    );
    renderBanner(pluginRequest);
    const banner = screen.getByTestId("plugin-request-banner");
    expect(banner.getAttribute("data-request-kind")).toBe(
      "secrets/secret-request",
    );
    expect(screen.getByTestId("secret-form").textContent).toBe("Add secrets");
  });

  it("renders a provider's plugin-defined request through the same slot, with the form's data", () => {
    function SecretForm({ interaction }: PluginPendingInteractionProps) {
      return (
        <div data-testid="secret-form">
          {interaction.title}:{JSON.stringify(interaction.payload)}
        </div>
      );
    }
    setPluginSlotRegistrations(
      "secrets",
      registrationSet({
        pendingInteractions: [{ id: "secret-request", component: SecretForm }],
      }),
    );
    renderBanner(providerPluginRequest);
    expect(
      screen
        .getByTestId("plugin-request-banner")
        .getAttribute("data-request-kind"),
    ).toBe("secrets/secret-request");
    expect(screen.getByTestId("secret-form").textContent).toBe(
      'Add a token:{"fields":["TOKEN"]}',
    );
    expect(screen.getByText(/The agent asks through/)).toBeTruthy();
  });

  it("backs out of a provider's request by stopping the turn, never by cancelling", () => {
    renderBanner(providerPluginRequest);
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stop turn" }));
    expect(mocks.stopMutateAsync).toHaveBeenCalledWith("thr_1");
  });
});

describe("ThreadPendingInteractionBanner presentation detail images", () => {
  it("renders an image in the bridge's detail as alt text, like the timeline row body", () => {
    const { container } = renderBanner({
      ...toolUseApproval,
      payload: {
        ...toolUseApproval.payload,
        subject: {
          kind: "tool_use",
          itemId: "call_1",
          tool: "mcp__github__create_issue",
          presentation: {
            label: { pending: "Creating issue", completed: "Created issue" },
            icon: { glyph: "Globe" },
            detail: "See ![pixel](https://tracker.example/pixel.png?x=1)",
          },
        },
      },
    });
    const ask = screen.getByTestId("tool-use-ask");
    expect(container.querySelector("img")).toBeNull();
    expect(ask.textContent).toContain("[Image: pixel]");
  });
});
