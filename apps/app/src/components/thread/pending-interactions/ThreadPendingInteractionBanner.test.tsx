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
import { resetAllCrashedPluginSlotsForTest } from "../../plugin/PluginSlotMount";
import { ThreadPendingInteractionBanner } from "./ThreadPendingInteractionBanner";

const mocks = vi.hoisted(() => ({
  resolveMutateAsync: vi.fn(async () => ({})),
}));

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
        <ThreadPendingInteractionBanner interaction={interaction} threadId="thr_1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
  mocks.resolveMutateAsync.mockClear();
});

describe("ThreadPendingInteractionBanner request family", () => {
  it("renders a plan review as a request with plan-verdict actions, resolved through today's approval", () => {
    renderBanner(planReview);
    expect(screen.getByText("Ready to code?")).toBeTruthy();
    expect(screen.getByTestId("plan-review-request").textContent).toContain(
      "Read labels from the declaration",
    );
    expect(screen.getByText("/tmp/plans/picker.md")).toBeTruthy();
    // Plan verdict vocabulary, not permission vocabulary.
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
      return (
        <div data-testid="secret-form">{interaction.title}</div>
      );
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
});
