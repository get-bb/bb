// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { PendingInteraction } from "@bb/domain";
import type { ThreadPendingInteractionAttentionEntry } from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import {
  BackgroundAttentionTray,
  backgroundAttentionLabel,
  selectBackgroundAttentionEntries,
} from "./BackgroundAttentionTray";
import { backgroundAttentionSourceTitle } from "./BackgroundAttentionTrayList";

const mocks = vi.hoisted(() => ({
  resolveMutateAsync: vi.fn(async () => ({})),
}));

vi.mock("@/hooks/mutations/thread-interaction-mutations", () => ({
  useResolveThreadPendingInteraction: () => ({
    mutateAsync: mocks.resolveMutateAsync,
    isPending: false,
    error: null,
  }),
  useCancelThreadPendingInteraction: () => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  }),
}));

vi.mock("@/lib/sdk", () => ({
  sdk: {
    threads: {
      experimental_listPendingInteractions: vi.fn(),
      interactions: { respond: vi.fn(), cancel: vi.fn() },
    },
  },
}));

vi.mock("@/lib/ws", () => ({
  wsManager: {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    getConnectionState: () => "connected",
    onConnectionStateChange: () => () => {},
  },
}));

function commandApproval(id: string, threadId: string): PendingInteraction {
  return {
    id,
    threadId,
    turnId: "turn_1",
    providerId: "claude-code",
    providerThreadId: "pt_1",
    providerRequestId: `req_${id}`,
    status: "pending",
    statusReason: null,
    createdAt: 1,
    resolvedAt: null,
    resolution: null,
    payload: {
      kind: "approval",
      reason: "This command requires approval",
      availableDecisions: ["allow_once", "allow_for_session", "deny"],
      subject: {
        kind: "command",
        itemId: `item_${id}`,
        command: `node -e "console.log('${id}')"`,
        cwd: null,
        actions: [],
        sessionGrant: null,
      },
    },
  };
}

function entry(overrides: {
  interactionId: string;
  threadId: string;
  title?: string | null;
  titleFallback?: string | null;
  owner?: ThreadPendingInteractionAttentionEntry["owner"];
}): ThreadPendingInteractionAttentionEntry {
  return {
    interaction: commandApproval(overrides.interactionId, overrides.threadId),
    thread: {
      id: overrides.threadId,
      projectId: "proj_1",
      title:
        overrides.title === undefined ? "review:correctness" : overrides.title,
      titleFallback: overrides.titleFallback ?? null,
      visibility: "hidden",
      originPluginId: "workflows",
    },
    owner:
      overrides.owner === undefined
        ? {
            id: "thr_origin",
            title: "Add due dates to tasks",
            titleFallback: null,
          }
        : overrides.owner,
  };
}

function renderTray(currentThreadId: string | null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <BackgroundAttentionTray currentThreadId={currentThreadId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const listPendingInteractions = vi.mocked(
  sdk.threads.experimental_listPendingInteractions,
);

beforeEach(() => {
  listPendingInteractions.mockReset();
  mocks.resolveMutateAsync.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("BackgroundAttentionTray", () => {
  it("renders nothing while no hidden thread is waiting", async () => {
    listPendingInteractions.mockResolvedValue([]);
    renderTray(null);
    await waitFor(() =>
      expect(listPendingInteractions).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: "hidden" }),
      ),
    );
    expect(screen.queryByTestId("background-attention-trigger")).toBeNull();
  });

  it("shows a hidden thread's approval and answers it for that thread", async () => {
    listPendingInteractions.mockResolvedValue([
      entry({ interactionId: "pint_hidden", threadId: "thr_worker" }),
    ]);
    renderTray("thr_other");

    const trigger = await screen.findByTestId("background-attention-trigger");
    expect(trigger.textContent).toContain("1 background thread needs you");

    fireEvent.click(trigger);
    const tray = await screen.findByTestId("background-attention-tray");
    const detailsToggle = await screen.findByRole("button", {
      name: "Hide details",
    });
    expect(detailsToggle.getAttribute("aria-expanded")).toBe("true");
    expect(tray.textContent).toContain("node -e");
    const sourceLink = screen.getByRole("link", {
      name: /review:correctness · Add due dates to tasks/,
    });
    expect(sourceLink.getAttribute("href")).toBe(
      "/projects/proj_1/threads/thr_worker",
    );

    fireEvent.click(screen.getByRole("button", { name: /allow once/i }));
    await waitFor(() => expect(mocks.resolveMutateAsync).toHaveBeenCalled());
    expect(mocks.resolveMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thr_worker",
        interactionId: "pint_hidden",
      }),
    );
  });

  it("leaves out the thread that is already open", async () => {
    listPendingInteractions.mockResolvedValue([
      entry({ interactionId: "pint_open", threadId: "thr_open" }),
      entry({ interactionId: "pint_elsewhere", threadId: "thr_elsewhere" }),
    ]);
    renderTray("thr_open");

    const trigger = await screen.findByTestId("background-attention-trigger");
    expect(trigger.textContent).toContain("1 background thread needs you");
  });

  it("hides the tray when the only waiting thread is the open one", async () => {
    listPendingInteractions.mockResolvedValue([
      entry({ interactionId: "pint_open", threadId: "thr_open" }),
    ]);
    renderTray("thr_open");
    await waitFor(() => expect(listPendingInteractions).toHaveBeenCalled());
    expect(screen.queryByTestId("background-attention-trigger")).toBeNull();
  });
});

describe("background attention helpers", () => {
  it("pluralises the trigger label", () => {
    expect(backgroundAttentionLabel(1)).toBe("1 background thread needs you");
    expect(backgroundAttentionLabel(3)).toBe("3 background threads need you");
  });

  it("names the thread and its owner, falling back when titles are missing", () => {
    expect(
      backgroundAttentionSourceTitle(
        entry({ interactionId: "a", threadId: "t" }),
      ),
    ).toBe("review:correctness · Add due dates to tasks");
    expect(
      backgroundAttentionSourceTitle(
        entry({
          interactionId: "b",
          threadId: "t",
          title: null,
          titleFallback: "[BB workflow] skeptic",
          owner: null,
        }),
      ),
    ).toBe("[BB workflow] skeptic");
    expect(
      backgroundAttentionSourceTitle(
        entry({
          interactionId: "c",
          threadId: "t",
          title: null,
          owner: { id: "o", title: null, titleFallback: "Origin fallback" },
        }),
      ),
    ).toBe("Background thread · Origin fallback");
  });

  it("filters the open thread only when one is open", () => {
    const entries = [
      entry({ interactionId: "a", threadId: "thr_a" }),
      entry({ interactionId: "b", threadId: "thr_b" }),
    ];
    expect(selectBackgroundAttentionEntries(entries, null)).toHaveLength(2);
    expect(
      selectBackgroundAttentionEntries(entries, "thr_a").map(
        (item) => item.thread.id,
      ),
    ).toEqual(["thr_b"]);
  });
});
