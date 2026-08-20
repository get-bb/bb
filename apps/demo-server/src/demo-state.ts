// The demo world: routes, seeded data, and the realtime socket in one Durable
// Object, so a message sent over HTTP and the socket that announces it cannot
// disagree.

import bootstrapFixture from "./fixtures/sidebar-bootstrap.json" with { type: "json" };
import configFixture from "./fixtures/system-config.json" with { type: "json" };
import executionOptionsFixture from "./fixtures/system-execution-options.json" with { type: "json" };
import versionFixture from "./fixtures/system-version.json" with { type: "json" };
import providersFixture from "./fixtures/system-providers.json" with { type: "json" };
import hostsFixture from "./fixtures/hosts.json" with { type: "json" };
import contributionsFixture from "./fixtures/plugins-contributions.json" with { type: "json" };
import tabsFixture from "./fixtures/thread-tabs.json" with { type: "json" };
import defaultExecutionOptionsFixture from "./fixtures/thread-default-execution-options.json" with { type: "json" };
import { DEMO_NOW } from "./fixtures/ids.js";
import {
  commandRow,
  conversationRow,
  timelineRows,
} from "./fixtures/timelines.js";

interface QueuedMessage {
  id: string;
  threadId: string;
  text: string;
}

const JSON_HEADERS = { "content-type": "application/json" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/**
 * Everything outside the demo path. A reviewer who wanders into an
 * unimplemented corner should read "not part of the demo", not see an empty
 * screen that looks like a bug.
 */
function notImplemented(path: string): Response {
  return json(
    {
      error: {
        code: "not_implemented",
        message: `The bb demo server does not implement ${path}. This server exists for App Store review and product demos; it serves fixed data and runs nothing.`,
      },
    },
    501,
  );
}

/** The canned reply a sent message produces, so the app shows a real turn. */
const DEMO_REPLY = [
  "That change is straightforward.",
  "",
  "I would put the toggle next to the other appearance settings and store the",
  "choice with the existing preferences, so it survives a restart.",
  "",
  "This is the bb demo server, so I am replaying a scripted answer rather than",
  "running a real agent.",
].join("\n");

export class DemoStateDO {
  private readonly sockets = new Set<WebSocket>();

  /** Rows appended by the current session, keyed by thread. */
  private readonly appended = new Map<string, Record<string, unknown>[]>();

  private queued: QueuedMessage[] = [];

  private nextId = 1;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/u, "") || "/";

    if (path === "/ws") {
      return this.handleWebSocket(request);
    }
    if (path === "/health") {
      return json({ ok: true });
    }

    const api = path.startsWith("/api/v1/")
      ? path.slice("/api/v1".length)
      : null;
    if (api === null) {
      return notImplemented(path);
    }

    if (request.method === "GET") {
      const response = this.handleGet(api);
      if (response) {
        return response;
      }
    }
    if (request.method === "POST") {
      const response = await this.handlePost(api, request);
      if (response) {
        return response;
      }
    }
    if (request.method === "PUT") {
      const response = await this.handlePut(api, request);
      if (response) {
        return response;
      }
    }
    return notImplemented(path);
  }

  private handleGet(api: string): Response | null {
    if (api === "/system/config") return json(configFixture);
    if (api === "/system/version") return json(versionFixture);
    if (api === "/system/execution-options")
      return json(executionOptionsFixture);
    if (api === "/sidebar-bootstrap") return json(bootstrapFixture);
    if (api === "/system/providers") return json(providersFixture);
    if (api === "/hosts") return json(hostsFixture);
    if (api === "/plugins/contributions") return json(contributionsFixture);
    if (api === "/threads") return json(this.threads());

    const thread = /^\/threads\/(thr_[a-z0-9]+)(\/[a-z-]+)?$/u.exec(api);
    if (!thread) {
      return null;
    }
    const [, threadId, sub] = thread;
    const seeded = this.threads().find((entry) => entry.id === threadId);
    if (!seeded) {
      return json(
        { error: { code: "not_found", message: `No thread ${threadId}` } },
        404,
      );
    }

    if (!sub) return json(seeded);
    if (sub === "/timeline") return json(this.timeline(threadId));
    if (sub === "/interactions") return json([]);
    if (sub === "/queued-messages") {
      return json(this.queued.filter((entry) => entry.threadId === threadId));
    }
    if (sub === "/tabs") return json(tabsFixture);
    if (sub === "/default-execution-options") {
      return json(defaultExecutionOptionsFixture);
    }
    return null;
  }

  private async handlePost(
    api: string,
    request: Request,
  ): Promise<Response | null> {
    // What the app actually calls when you press send. Verified from the
    // worker request log, not from the SDK surface: `threads.send` in the SDK
    // is the queued-message path, which the composer does not use.
    const direct = /^\/threads\/(thr_[a-z0-9]+)\/send$/u.exec(api);
    if (direct) {
      const threadId = direct[1];
      const body = (await request.json().catch(() => ({}))) as {
        text?: string;
      };
      this.appendTurn(threadId, body.text ?? "");
      this.broadcast(threadId);
      return json({ ok: true });
    }

    const created = /^\/threads\/(thr_[a-z0-9]+)\/queued-messages$/u.exec(api);
    if (created) {
      const threadId = created[1];
      const body = (await request.json().catch(() => ({}))) as {
        text?: string;
      };
      const message: QueuedMessage = {
        id: `qm_demo${this.nextId++}`,
        threadId,
        text: body.text ?? "",
      };
      this.queued.push(message);
      return json(message);
    }

    const sent =
      /^\/threads\/(thr_[a-z0-9]+)\/queued-messages\/([a-z0-9_]+)\/send$/u.exec(
        api,
      );
    if (sent) {
      const [, threadId, queuedMessageId] = sent;
      const message = this.queued.find((entry) => entry.id === queuedMessageId);
      this.queued = this.queued.filter((entry) => entry.id !== queuedMessageId);
      this.appendTurn(threadId, message?.text ?? "");
      // The app refetches the timeline when the socket says the thread moved,
      // so a broadcast is enough; the demo does not stream deltas.
      this.broadcast(threadId);
      return json({ ok: true });
    }

    return null;
  }

  /**
   * The thread screen persists its panel tabs on open. A 501 here is not
   * harmless: the app retries and stacks "Couldn't sync tabs" toasts over the
   * timeline, which is what a reviewer would see and report as broken. The
   * demo accepts the write and echoes it back without storing it.
   */
  private async handlePut(
    api: string,
    request: Request,
  ): Promise<Response | null> {
    const tabs = /^\/threads\/(thr_[a-z0-9]+)\/tabs$/u.exec(api);
    if (!tabs) {
      return null;
    }
    const body = (await request.json().catch(() => ({}))) as {
      revision?: number;
      tabs?: unknown[];
    };
    return json({ revision: (body.revision ?? 0) + 1, tabs: body.tabs ?? [] });
  }

  private threads(): { id: string; [key: string]: unknown }[] {
    const project = (bootstrapFixture as { projects: { threads: unknown[] }[] })
      .projects[0];
    return project.threads as { id: string; [key: string]: unknown }[];
  }

  private timeline(threadId: string): Record<string, unknown> {
    const rows = [
      ...timelineRows(threadId),
      ...(this.appended.get(threadId) ?? []),
    ];
    return {
      maxSeq: rows.length,
      rows,
      activePromptMode: null,
      activeThinking: null,
      activeWorkflows: [],
      activeBackgroundCommands: [],
      pendingTodos: null,
      goal: null,
      modelFallback: null,
      contextWindowUsage: {
        estimated: false,
        modelContextWindow: 258_400,
        usedTokens: 12_400,
      },
      timelinePage: {
        kind: "latest",
        segmentLimit: 20,
        returnedSegmentCount: 1,
        hasOlderRows: false,
        olderCursor: null,
      },
    };
  }

  /** Appends the user's message and the scripted reply to a thread. */
  private appendTurn(threadId: string, text: string): void {
    const existing = this.appended.get(threadId) ?? [];
    const base = timelineRows(threadId).length + existing.length;
    const at = DEMO_NOW + base * 1_000;
    existing.push(
      conversationRow(threadId, base + 1, at, "user", text),
      commandRow(
        threadId,
        base + 2,
        at + 1_000,
        "rg -n 'appearance' src --type ts",
        'src/settings/appearance.ts:14:export const THEME_KEY = "theme";',
      ),
      conversationRow(threadId, base + 3, at + 2_000, "assistant", DEMO_REPLY),
    );
    this.appended.set(threadId, existing);
  }

  private handleWebSocket(request: Request): Response {
    if (request.headers.get("upgrade") !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.sockets.add(server);
    server.addEventListener("close", () => this.sockets.delete(server));
    server.addEventListener("error", () => this.sockets.delete(server));
    // The app pings; anything it sends that is not a ping is ignored, because
    // subscriptions do not matter when every client sees the same world.
    server.addEventListener("message", (event) => {
      const raw = typeof event.data === "string" ? event.data : "";
      if (raw.includes('"ping"')) {
        server.send(JSON.stringify({ type: "pong" }));
      }
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  private broadcast(threadId: string): void {
    const message = JSON.stringify({
      type: "changed",
      target: { kind: "thread", threadId },
      changeKinds: ["timeline", "status"],
    });
    for (const socket of this.sockets) {
      try {
        socket.send(message);
      } catch {
        this.sockets.delete(socket);
      }
    }
  }
}
