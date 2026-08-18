// bb-plugin-cascade — scrollable-tiling thread layout, niri style.
//
// The backend is deliberately thin. It owns three things:
//   1. The *index* — the row/column metadata for the strip.
//   2. The mutations the layout performs, each one existing SDK call.
//   3. Layout state (grouping mode, widths, focus memory) in plugin kv.
//
// It deliberately does NOT proxy thread content: the frontend renders the
// host's own `ThreadChat`, which loads and streams its own timeline.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import { z } from "zod";

const LAYOUT_KEY = "layout";

// How many threads the index pulls. The strip is a working surface, not an
// archive browser; past this the answer is search, not more columns.
const THREAD_LIMIT = 400;

/**
 * The composer's resolved `NewThreadRequest`, arriving over HTTP — the one
 * genuinely unknowable boundary here. A structural check narrows it; bb's own
 * `threads.spawn` re-validates every field against the real create-thread
 * schema, so this deliberately does not restate bb's enums (they would drift).
 */
function isNewThreadRequest(value: unknown): value is NewThreadRequest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const isNonEmptyString = (field: unknown) =>
    typeof field === "string" && field.length > 0;
  return (
    isNonEmptyString(candidate.projectId) &&
    isNonEmptyString(candidate.providerId) &&
    isNonEmptyString(candidate.model) &&
    isNonEmptyString(candidate.reasoningLevel) &&
    isNonEmptyString(candidate.permissionMode) &&
    (candidate.serviceTier === undefined ||
      isNonEmptyString(candidate.serviceTier)) &&
    typeof candidate.executionInputSources === "object" &&
    candidate.executionInputSources !== null &&
    typeof candidate.environment === "object" &&
    candidate.environment !== null &&
    Array.isArray(candidate.input) &&
    candidate.input.length > 0
  );
}

const newThreadRequestSchema = z.custom<NewThreadRequest>(isNewThreadRequest, {
  message: "Expected a NewThreadRequest from the bb composer",
});

const namedSchema = z.object({ id: z.string(), name: z.string() });

const columnSchema = z.object({
  threadId: z.string(),
  title: z.string(),
  projectId: z.string(),
  sectionId: z.string().nullable(),
  hostId: z.string().nullable(),
  parentThreadId: z.string().nullable(),
  status: z.string(),
  displayStatus: z.string(),
  branchName: z.string().nullable(),
  pinned: z.boolean(),
  // Server-side pin ordering, shared with the sidebar.
  pinSortKey: z.string().nullable(),
  unread: z.boolean(),
  needsAttention: z.boolean(),
  activeWorkCount: z.number().int().nonnegative(),
  // Deliberately createdAt, not updatedAt: column position is anchored to it,
  // and updatedAt changes on every turn (see applyOrder in lib/rows.ts).
  createdAt: z.number(),
});

const indexSchema = z.object({
  sections: z.array(namedSchema),
  projects: z.array(namedSchema),
  hosts: z.array(namedSchema),
  threads: z.array(columnSchema),
});

const layoutSchema = z.object({
  mode: z.enum(["sections", "projects", "hosts"]),
  // Column width preset index per thread id (0 = 1/3, 1 = 1/2, 2 = 2/3).
  widths: z.record(z.string(), z.number().int().min(0).max(2)),
  // Focused column index per row key, so switching grouping keeps your place.
  focus: z.record(z.string(), z.number().int().nonnegative()),
  // Manual column order per row key. Threads absent from the list fall back to
  // recency. There is no server-side per-section thread order to reuse — only
  // pinned threads have one (`pinSortKey`) — so this stays plugin-local.
  order: z.record(z.string(), z.array(z.string())),
});
type Layout = z.infer<typeof layoutSchema>;

const DEFAULT_LAYOUT: Layout = {
  mode: "sections",
  widths: {},
  focus: {},
  order: {},
};

const okSchema = z.object({ ok: z.literal(true) });

export const rpcContract = defineRpcContract({
  index: { input: z.null(), output: indexSchema },
  layout: { input: z.null(), output: layoutSchema },
  setLayout: { input: layoutSchema.partial(), output: layoutSchema },
  moveThread: {
    input: z.object({
      threadId: z.string().min(1),
      sectionId: z.string().min(1).nullable(),
    }),
    output: okSchema,
  },
  setPinned: {
    input: z.object({ threadId: z.string().min(1), pinned: z.boolean() }),
    output: okSchema,
  },
  // Server-side pin ordering, so a reorder in the Pinned row also moves it in
  // the sidebar. Fractional placement between two neighbours.
  reorderPinned: {
    input: z.object({
      threadId: z.string().min(1),
      previousThreadId: z.string().min(1).nullable(),
      nextThreadId: z.string().min(1).nullable(),
    }),
    output: okSchema,
  },
  archiveThread: {
    input: z.object({ threadId: z.string().min(1) }),
    output: okSchema,
  },
  unarchiveThread: {
    input: z.object({ threadId: z.string().min(1) }),
    output: okSchema,
  },
  createThread: {
    input: z.object({
      /** Every selection the host composer resolved, forwarded verbatim. */
      request: newThreadRequestSchema,
      // Filing is ours, not the composer's — it resolves what to run, we
      // decide where the thread lands in the strip.
      sectionId: z.string().min(1).nullable(),
      parentThreadId: z.string().min(1).nullable(),
      pinned: z.boolean(),
    }),
    output: z.object({ threadId: z.string() }),
  },
  createSection: {
    input: z.object({ name: z.string().min(1) }),
    output: namedSchema,
  },
  renameSection: {
    input: z.object({ id: z.string().min(1), name: z.string().min(1) }),
    output: okSchema,
  },
  deleteSection: {
    input: z.object({ id: z.string().min(1) }),
    output: okSchema,
  },
});

export default async function plugin(bb: BbPluginApi) {
  async function readLayout(): Promise<Layout> {
    const stored = await bb.storage.kv.get<unknown>(LAYOUT_KEY);
    const parsed = layoutSchema.safeParse(stored);
    return parsed.success ? parsed.data : DEFAULT_LAYOUT;
  }

  bb.rpc.register(rpcContract, {
    // The whole index in four parallel reads. Every grouping key, the status
    // dot, the branch tag, and the unread mark come from `ThreadListEntry`
    // itself — the strip never fans out per thread.
    async index() {
      const [sections, projects, hosts, threads] = await Promise.all([
        bb.sdk.threadSections.list(),
        bb.sdk.projects.list({ includePersonal: true }),
        bb.sdk.hosts.list().catch(() => []),
        // Filter server-side: archived threads are not columns, and the
        // default list already excludes hidden threads such as side chats.
        bb.sdk.threads.list({
          archived: false,
          limit: THREAD_LIMIT,
        }),
      ]);

      return {
        sections: sections.map((s) => ({ id: s.id, name: s.name })),
        projects: projects.map((p) => ({ id: p.id, name: p.name })),
        hosts: hosts.map((h) => ({ id: h.id, name: h.name })),
        threads: threads.map((thread) => ({
          threadId: thread.id,
          title: thread.title ?? thread.titleFallback ?? "Untitled",
          projectId: thread.projectId,
          sectionId: thread.sectionId,
          hostId: thread.environmentHostId,
          parentThreadId: thread.parentThreadId,
          status: thread.status,
          displayStatus: thread.runtime.displayStatus,
          branchName: thread.environmentBranchName,
          pinned: thread.pinnedAt !== null,
          pinSortKey: thread.pinSortKey,
          unread:
            thread.lastReadAt === null ||
            thread.latestAttentionAt > thread.lastReadAt,
          needsAttention: thread.hasPendingInteraction,
          activeWorkCount:
            thread.activity.activeWorkflowCount +
            thread.activity.activeBackgroundAgentCount +
            thread.activity.activeBackgroundCommandCount,
          createdAt: thread.createdAt,
        })),
      };
    },

    layout: () => readLayout(),

    async setLayout(patch) {
      const next = { ...(await readLayout()), ...patch };
      await bb.storage.kv.set(LAYOUT_KEY, next);
      return next;
    },

    async moveThread({ threadId, sectionId }) {
      await bb.sdk.threads.update({ threadId, sectionId });
      return { ok: true as const };
    },

    async setPinned({ threadId, pinned }) {
      if (pinned) await bb.sdk.threads.pin({ threadId });
      else await bb.sdk.threads.unpin({ threadId });
      return { ok: true as const };
    },

    async reorderPinned({ threadId, previousThreadId, nextThreadId }) {
      await bb.sdk.threads.reorderPinned({
        threadId,
        previousThreadId,
        nextThreadId,
      });
      return { ok: true as const };
    },

    async archiveThread({ threadId }) {
      await bb.sdk.threads.archive({ threadId });
      return { ok: true as const };
    },

    async unarchiveThread({ threadId }) {
      await bb.sdk.threads.unarchive({ threadId });
      return { ok: true as const };
    },

    async createThread({ request, sectionId, parentThreadId, pinned }) {
      // The composer resolved project, provider, model, reasoning, permission
      // mode, environment, and prompt; we only add where it lands. `spawn`
      // fills in origin: "plugin" + originPluginId, which is exactly why the
      // creation happens here rather than inside the composer component.
      const thread = await bb.sdk.threads.spawn({
        ...request,
        ...(sectionId ? { sectionId } : {}),
        ...(parentThreadId ? { parentThreadId } : {}),
      });
      if (pinned) await bb.sdk.threads.pin({ threadId: thread.id });
      return { threadId: thread.id };
    },

    async createSection({ name }) {
      const section = await bb.sdk.threadSections.create({ name });
      return { id: section.id, name: section.name };
    },

    async renameSection({ id, name }) {
      await bb.sdk.threadSections.update({ id, name });
      return { ok: true as const };
    },

    async deleteSection({ id }) {
      await bb.sdk.threadSections.delete({ id });
      return { ok: true as const };
    },
  });

  // Live index. Thread *content* streams through ThreadChat on its own, so
  // this signal only has to say "something in the index moved" and let the
  // frontend refetch.
  //
  // The window is deliberately wide. A running thread emits `thread:changed`
  // continuously, and each refetch costs four SDK round-trips — but the index
  // only carries titles, status dots, and grouping keys, so a second of
  // staleness is invisible. Leading-edge, so the first change is prompt.
  bb.background.service("index-watch", {
    async start(signal) {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const publish = () => {
        if (timer) return;
        bb.realtime.publish("index", { at: Date.now() });
        timer = setTimeout(() => {
          timer = null;
        }, 1000);
      };

      const unsubscribe = bb.sdk.subscribe({
        event: "thread:changed",
        callback: publish,
      });

      await new Promise<void>((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            if (timer) clearTimeout(timer);
            unsubscribe();
            resolve();
          },
          { once: true },
        );
      });
    },
  });

  bb.log.info("cascade loaded");
}
