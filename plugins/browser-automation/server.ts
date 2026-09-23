import { randomUUID } from "node:crypto";
import { posix, win32 } from "node:path";
import type {
  BbPluginApi,
  PluginCliContext,
  PluginRpcHandlers,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  hostContract,
  rpcContract,
  sessionSchema,
  type PreviewOutput,
  type RunOutput,
  type Session,
} from "./contracts.js";
import {
  browserCliFailure,
  createBrowserAutomationCli,
  type BrowserCliMethod,
  type BrowserCliRequest,
} from "./cli.js";
import { previewDirective } from "./preview-directive.js";

const desktopSchema = z
  .object({
    hostId: z.string(),
    instanceId: z.string(),
    generation: z.string(),
    threadId: z.string(),
    leaseId: z.string(),
    tabId: z.string(),
    owned: z.boolean(),
    profileId: z.string().nullable(),
  })
  .strict();
const recordSchema = z
  .object({
    session: sessionSchema,
    desktop: desktopSchema.nullable(),
    lastUsed: z.number(),
    cleanupPending: z.boolean(),
  })
  .strict();
type RecordEntry = z.infer<typeof recordSchema>;
const ttlMs = 30 * 60_000;
const idleTimeoutMs = 5 * 60_000;
const previewWaitMs = 5_000;
const keyFor = (threadId: string, sessionId: string) =>
  `sessions/${encodeURIComponent(threadId)}/${sessionId}`;

export default async function browserAutomationPlugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });
  const desktop = bb.sdk.experimental_desktopBrowsers;
  const active = new Map<string, RecordEntry>();
  const busy = new Map<string, number>();
  const pending = new Set<Promise<void>>();
  const cleanup = new Map<string, Promise<Session>>();
  const subscriptions = new Map<string, { dispose(): void }>();
  const lifecycle = new AbortController();
  const threadLifecycles = new Map<string, AbortController>();
  const save = (record: RecordEntry) =>
    bb.storage.kv.set(
      keyFor(record.session.threadId, record.session.id),
      record,
    );
  async function owned(threadId: string, sessionId: string) {
    const record = recordSchema.parse(
      await bb.storage.kv.get(keyFor(threadId, sessionId)),
    );
    if (record.session.threadId !== threadId || record.session.id !== sessionId)
      throw new Error("Session does not belong to this thread");
    return active.get(sessionId) ?? record;
  }
  async function finish(record: RecordEntry, state: "stopped" | "closed") {
    const existing = cleanup.get(record.session.id);
    if (existing) {
      await existing;
      return finish(record, state);
    }
    const previous = recordSchema.safeParse(
      await bb.storage.kv.get(
        keyFor(record.session.threadId, record.session.id),
      ),
    );
    const concurrent = cleanup.get(record.session.id);
    if (concurrent) {
      await concurrent;
      return finish(record, state);
    }
    if (
      previous.success &&
      previous.data.session.state === "closed" &&
      !previous.data.cleanupPending
    )
      return previous.data.session;
    const work = (async () => {
      const { session } = record;
      if (state === "closed") active.delete(session.id);
      else active.set(session.id, record);
      subscriptions.get(session.id)?.dispose();
      subscriptions.delete(session.id);
      session.state = state;
      record.cleanupPending = true;
      await save(record);
      const target = record.desktop;
      const scope = target
        ? {
            hostId: target.hostId,
            instanceId: target.instanceId,
            generation: target.generation,
            threadId: target.threadId,
          }
        : null;
      const results = await Promise.allSettled([
        host.call(
          "close",
          { sessionId: session.id },
          { hostId: session.hostId, signal: AbortSignal.timeout(10_000) },
        ),
        ...(target && scope
          ? [desktop.releaseControl({ ...scope, leaseId: target.leaseId })]
          : []),
      ]);
      if (state === "closed" && target?.owned && scope) {
        const tabs = await desktop.listTabs(scope);
        const ownedTabs = tabs.tabs.filter(
          (tab) =>
            tab.tabId === target.tabId ||
            (target.profileId !== null &&
              tab.profile.kind === "automation" &&
              tab.profile.id === target.profileId),
        );
        results.push(
          ...(await Promise.allSettled(
            ownedTabs.map((tab) =>
              desktop.closeTab({ ...scope, tabId: tab.tabId }),
            ),
          )),
        );
      }
      record.cleanupPending = results.some(
        (result) => result.status === "rejected",
      );
      await save(record);
      if (record.cleanupPending)
        bb.log.warn(
          `Browser Automation cleanup on host ${session.hostId} incomplete; host expiry and lease revocation remain active.`,
        );
      return session;
    })();
    cleanup.set(record.session.id, work);
    try {
      return await work;
    } finally {
      cleanup.delete(record.session.id);
    }
  }
  for (const key of await bb.storage.kv.list("sessions/")) {
    const parsed = recordSchema.safeParse(await bb.storage.kv.get(key));
    if (!parsed.success) continue;
    if (parsed.data.session.state === "closed" && !parsed.data.cleanupPending)
      continue;
    await finish(parsed.data, "closed").catch(() =>
      bb.log.warn(
        "Browser Automation restart cleanup will need the owning desktop to reconnect",
      ),
    );
  }
  async function open(
    input: z.output<typeof rpcContract.open.input>,
    signal: AbortSignal,
  ): Promise<Session> {
    let threadLifecycle = threadLifecycles.get(input.threadId);
    if (!threadLifecycle) {
      threadLifecycle = new AbortController();
      threadLifecycles.set(input.threadId, threadLifecycle);
    }
    signal = AbortSignal.any([signal, threadLifecycle.signal]);
    signal.throwIfAborted();
    await bb.sdk.threads.get({ threadId: input.threadId });
    if (active.size >= 64)
      throw new Error(
        "Browser session limit reached; close an existing session",
      );
    const now = Date.now();
    const session: Session = {
      id: randomUUID(),
      threadId: input.threadId,
      hostId: input.selection.hostId,
      backend: input.selection.backend,
      state: "ready",
      createdAt: now,
      expiresAt: now + ttlMs,
    };
    const record: RecordEntry = {
      session,
      desktop: null,
      lastUsed: now,
      cleanupPending: false,
    };
    let connectionUrl: string | undefined;
    let created: {
      hostId: string;
      instanceId: string;
      generation: string;
      threadId: string;
      tabId: string;
    } | null = null;
    try {
      if (input.selection.backend === "desktop") {
        const selection = input.selection;
        const { instances } = await desktop.listInstances({
          hostId: selection.hostId,
        });
        const instance = instances.find(
          (candidate) => candidate.instanceId === selection.instanceId,
        );
        if (!instance)
          throw new Error(
            "Selected desktop is unavailable; choose a connected instance explicitly",
          );
        const scope = {
          hostId: selection.hostId,
          instanceId: instance.instanceId,
          generation: instance.generation,
          threadId: input.threadId,
        };
        let tabId = selection.tabId;
        let profileId: string | null = null;
        if (!tabId) {
          const result = await desktop.createTab({
            ...scope,
            url: "about:blank",
            presentation: "hidden",
          });
          tabId = result.tab.tabId;
          profileId =
            result.tab.profile.kind === "automation"
              ? result.tab.profile.id
              : null;
          created = { ...scope, tabId };
        }
        const lease = await desktop.acquireControl({
          ...scope,
          tabIds: [tabId],
          controllerLabel: "Browser Automation",
          ttlMs,
          allowPersonal: selection.tabId !== undefined,
        });
        record.desktop = {
          ...scope,
          leaseId: lease.leaseId,
          tabId,
          owned: selection.tabId === undefined,
          profileId,
        };
        const connection = await desktop.openConnection({
          ...scope,
          leaseId: lease.leaseId,
        });
        if (connection.hostId !== scope.hostId)
          throw new Error(
            "Desktop connection returned a different execution host",
          );
        connectionUrl = connection.wsEndpoint;
        session.expiresAt = Math.min(
          session.expiresAt,
          lease.expiresAt,
          connection.expiresAt,
        );
      }
      await save(record);
      active.set(session.id, record);
      while (true) {
        const runtime = await host.call(
          "prepare",
          {},
          { hostId: session.hostId, signal },
        );
        if (runtime.status === "ready") break;
        bb.log.info(
          `DevBrowser runtime on host ${session.hostId}: ${runtime.detail}`,
        );
      }
      await host.call(
        "open",
        {
          sessionId: session.id,
          ...(connectionUrl === undefined ? {} : { connectionUrl }),
          expiresAt: session.expiresAt,
          idleTimeoutMs,
        },
        { hostId: session.hostId, signal },
      );
      signal.throwIfAborted();
      if (record.desktop) {
        const target = record.desktop;
        subscriptions.set(
          session.id,
          desktop.subscribe({
            hostId: target.hostId,
            instanceId: target.instanceId,
            generation: target.generation,
            threadId: target.threadId,
            onChange(result) {
              if (
                !result.tabs.some(
                  (tab) => tab.control?.leaseId === target.leaseId,
                )
              )
                void finish(record, "stopped").catch(() => {});
            },
            onError() {
              void finish(record, "stopped").catch(() => {});
            },
          }),
        );
      }
      return session;
    } catch (error) {
      await finish(record, "closed").catch(() => {});
      if (created && !record.desktop)
        await desktop.closeTab(created).catch(() => {});
      throw error;
    }
  }
  async function run(
    input: z.output<typeof rpcContract.run.input>,
    signal: AbortSignal,
  ): Promise<RunOutput> {
    const record = await owned(input.threadId, input.sessionId);
    if (
      record.session.state !== "ready" ||
      Date.now() >= record.session.expiresAt
    )
      throw new Error("Session stopped or expired; open a new session");
    busy.set(input.sessionId, (busy.get(input.sessionId) ?? 0) + 1);
    try {
      const result = await host.call(
        "run",
        {
          sessionId: input.sessionId,
          script: input.script,
          timeoutMs: input.timeoutMs,
        },
        { hostId: record.session.hostId, signal },
      );
      if (result.exitCode === 124) await finish(record, "stopped");
      return result;
    } catch (error) {
      await finish(record, "stopped");
      throw error;
    } finally {
      const remaining = (busy.get(input.sessionId) ?? 1) - 1;
      if (remaining > 0) busy.set(input.sessionId, remaining);
      else busy.delete(input.sessionId);
      const current = active.get(input.sessionId);
      if (current) {
        current.lastUsed = Date.now();
        await save(current);
      }
    }
  }
  async function preview(
    input: z.output<typeof rpcContract.preview.input>,
    signal: AbortSignal,
  ): Promise<PreviewOutput> {
    const { session } = await owned(input.threadId, input.sessionId);
    if (
      session.backend !== "local" ||
      session.state !== "ready" ||
      Date.now() >= session.expiresAt
    )
      return { session, frame: null };
    const { frame } = await host.call(
      "preview",
      {
        sessionId: session.id,
        afterSequence: input.afterSequence,
        waitMs: previewWaitMs,
        size: input.size,
      },
      { hostId: session.hostId, signal },
    );
    return { session, frame };
  }
  function handlers(
    signal: AbortSignal,
  ): PluginRpcHandlers<typeof rpcContract> {
    return {
      open: (input) => open(input, signal),
      async list({ threadId }) {
        const records = await Promise.all(
          (
            await bb.storage.kv.list(
              `sessions/${encodeURIComponent(threadId)}/`,
            )
          )
            .slice(-64)
            .map(
              async (key) =>
                recordSchema.parse(await bb.storage.kv.get(key)).session,
            ),
        );
        return records;
      },
      run: (input) => run(input, signal),
      pages: (input) =>
        run(
          { ...input, script: "await browser.listPages()", timeoutMs: 30_000 },
          signal,
        ),
      screenshot: (input) =>
        run(
          {
            ...input,
            script: `const page = await browser.getPage(${JSON.stringify(input.page)}); await page.shot({ type: "jpeg", maxEdge: 960, quality: 70 }); undefined`,
            timeoutMs: 30_000,
          },
          signal,
        ),
      preview: (input) => preview(input, signal),
      stop: async (input) =>
        finish(await owned(input.threadId, input.sessionId), "stopped"),
      close: async (input) =>
        finish(await owned(input.threadId, input.sessionId), "closed"),
    };
  }
  bb.rpc.register(rpcContract, handlers(lifecycle.signal));
  function dispatch(
    method: BrowserCliMethod,
    input: unknown,
    signal: AbortSignal,
  ) {
    const h = handlers(signal);
    switch (method) {
      case "open":
        return h.open(rpcContract.open.input.parse(input));
      case "list":
        return h.list(rpcContract.list.input.parse(input));
      case "run":
        return h.run(rpcContract.run.input.parse(input));
      case "pages":
        return h.pages(rpcContract.pages.input.parse(input));
      case "screenshot":
        return h.screenshot(rpcContract.screenshot.input.parse(input));
      case "preview":
        return h.preview(rpcContract.preview.input.parse(input));
      case "stop":
        return h.stop(rpcContract.stop.input.parse(input));
      case "close":
        return h.close(rpcContract.close.input.parse(input));
    }
  }
  bb.agents.configure(() => ({
    tools: [],
    skills: ["browser-automation"],
    instructions:
      "When `bb browser-automation open` returns a previewDirective, copy it into your next response exactly once as a standalone line before you continue working. Do not wrap it in backticks or a code fence, and do not invent or edit the session ID. The directive shows the user a live view of that headless browser in BB chat. Desktop sessions return no directive.",
  }));
  async function executeCli(
    request: BrowserCliRequest,
    context: PluginCliContext,
  ) {
    try {
      const input = { ...request.input };
      if (request.method === "open" && input.selection) {
        const target = input.selection.hostId.trim();
        const hosts = await bb.sdk.hosts.list({ signal: context.signal });
        const idMatch = hosts.find((candidate) => candidate.id === target);
        const matches = idMatch
          ? [idMatch]
          : hosts.filter((candidate) => candidate.name === target);
        if (matches.length === 0)
          throw new Error(`Machine '${target}' was not found`);
        if (matches.length > 1)
          throw new Error(
            `Machine name '${target}' is ambiguous; use an exact host ID`,
          );
        input.selection = { ...input.selection, hostId: matches[0].id };
      }
      if (request.scriptFile) {
        if (!request.scriptHost)
          throw new Error("Script file requires an explicit source host");
        const pathApi =
          context.cwd && win32.isAbsolute(context.cwd) ? win32 : posix;
        const path =
          win32.isAbsolute(request.scriptFile) ||
          posix.isAbsolute(request.scriptFile)
            ? request.scriptFile
            : pathApi.resolve(context.cwd ?? ".", request.scriptFile);
        if (
          !context.cwd &&
          !posix.isAbsolute(request.scriptFile) &&
          !win32.isAbsolute(request.scriptFile)
        )
          throw new Error(
            "Relative script files require the invoking CLI working directory",
          );
        const file = await bb.sdk.files.read({
          hostId: request.scriptHost,
          path,
          signal: context.signal,
        });
        if (file.contentEncoding !== "utf8")
          throw new Error("Script file must be UTF-8 text");
        input.script = file.content;
      }
      const result = await dispatch(
        request.method,
        input,
        AbortSignal.any([
          context.signal ?? new AbortController().signal,
          lifecycle.signal,
        ]),
      );
      const output = rpcContract.run.output.safeParse(result);
      const previewed = rpcContract.preview.output.safeParse(result);
      const opened =
        request.method === "open"
          ? rpcContract.open.output.safeParse(result)
          : null;
      const printable = opened?.success
        ? {
            ...opened.data,
            ...(opened.data.backend === "local"
              ? { previewDirective: previewDirective(opened.data.id) }
              : {}),
          }
        : output.success
          ? {
              ...output.data,
              hostId: (await owned(input.threadId, input.sessionId ?? ""))
                .session.hostId,
            }
          : previewed.success
            ? {
                session: previewed.data.session,
                frame: previewed.data.frame && {
                  sequence: previewed.data.frame.sequence,
                  mimeType: previewed.data.frame.mimeType,
                  width: previewed.data.frame.width,
                  height: previewed.data.frame.height,
                  url: previewed.data.frame.url,
                  title: previewed.data.frame.title,
                  bytes: Buffer.byteLength(previewed.data.frame.data, "base64"),
                },
              }
            : result;
      return {
        exitCode: output.success ? output.data.exitCode : 0,
        stdout: JSON.stringify(printable),
      };
    } catch (error) {
      throw browserCliFailure(error);
    }
  }
  bb.cli.register(createBrowserAutomationCli({ execute: executeCli }));
  for (const event of [
    "thread.archived",
    "thread.deleted",
    "thread.failed",
  ] as const) {
    bb.events.on(event, async ({ thread }) => {
      threadLifecycles.get(thread.id)?.abort();
      threadLifecycles.delete(thread.id);
      const results = await Promise.allSettled(
        [...active.values()]
          .filter((record) => record.session.threadId === thread.id)
          .map((record) => finish(record, "closed")),
      );
      if (results.some((result) => result.status === "rejected")) {
        bb.log.warn(
          `Browser Automation cleanup for thread ${thread.id} needs its host to reconnect`,
        );
      }
    });
  }
  const timer = setInterval(() => {
    for (const record of active.values()) {
      if (
        Date.now() < record.session.expiresAt &&
        (busy.get(record.session.id) ||
          Date.now() - record.lastUsed < idleTimeoutMs)
      )
        continue;
      const work = finish(record, "closed").then(
        () => {},
        () => {},
      );
      pending.add(work);
      void work.finally(() => pending.delete(work));
    }
  }, 1000);
  timer.unref();
  host.experimental_onWorkerExit(async ({ hostId }) => {
    await Promise.all(
      [...active.values()]
        .filter((record) => record.session.hostId === hostId)
        .map((record) => finish(record, "closed")),
    );
  });
  bb.onDispose(async () => {
    lifecycle.abort();
    clearInterval(timer);
    await Promise.allSettled(
      [...active.values()].map((record) => finish(record, "closed")),
    );
    await Promise.allSettled(pending);
  });
}
