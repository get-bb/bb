import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { collectorProgressSchema, collectorResultSchema } from "./collector.js";
import { collectorSource } from "./collector-source.js";

type EntryCallback = (list: { getEntries: () => unknown[] }) => void;
type MessageListener = (event: { data: unknown }) => void;

type BenchApi = {
  start: (options: unknown) => unknown;
  progress: () => unknown;
  stop: () => unknown;
};

type DevtoolsHook = { onCommitFiberRoot: () => void };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readBench(context: Record<string, unknown>): BenchApi {
  const bench = context.__bbStreamBench;
  if (
    !isRecord(bench) ||
    typeof bench.start !== "function" ||
    typeof bench.progress !== "function" ||
    typeof bench.stop !== "function"
  ) {
    throw new Error("collector did not install __bbStreamBench");
  }
  const { start, progress, stop } = bench;
  return {
    start: (options) => start.call(bench, options),
    progress: () => progress.call(bench),
    stop: () => stop.call(bench),
  };
}

function readHook(context: Record<string, unknown>): DevtoolsHook {
  const hook = context.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!isRecord(hook) || typeof hook.onCommitFiberRoot !== "function") {
    throw new Error("collector did not install a DevTools hook");
  }
  const { onCommitFiberRoot } = hook;
  return { onCommitFiberRoot: () => onCommitFiberRoot.call(hook) };
}

function createPage(
  options: {
    existingHook?: object;
    rootMounted?: boolean;
    supportedEntryTypes?: string[];
  } = {},
) {
  let performanceNow = 0;
  let epochNow = 1_700_000_000_000;
  let nextHandle = 1;
  let rootMounted = options.rootMounted ?? true;
  let rootQueries = 0;
  let messageReads = 0;
  let failNextRead = false;
  const frameCallbacks = new Map<number, (now: number) => void>();
  const mutationCallbacks = new Map<() => void, unknown>();
  const observedTargets: unknown[] = [];
  const entryCallbacks = new Map<string, EntryCallback>();
  const sockets: FakeWebSocket[] = [];

  const makeRoot = () => {
    const message = { textContent: "" };
    return {
      isConnected: true,
      message,
      querySelectorAll: () => {
        messageReads += 1;
        if (failNextRead) {
          failNextRead = false;
          throw new Error("message read failed");
        }
        return [message];
      },
    };
  };
  let root = makeRoot();

  const document = {
    querySelector: (selector: string) => {
      if (selector.includes("[[")) {
        throw new SyntaxError(`'${selector}' is not a valid selector.`);
      }
      rootQueries += 1;
      return selector === "#root" && rootMounted ? root : null;
    },
  };

  const notifyMutation = (inRoot: boolean) => {
    for (const [callback, target] of [...mutationCallbacks]) {
      if (target === document || (inRoot && target === root)) {
        callback();
      }
    }
  };

  class FakeMutationObserver {
    private readonly callback: () => void;
    constructor(callback: () => void) {
      this.callback = callback;
    }
    observe(target: unknown) {
      observedTargets.push(target);
      mutationCallbacks.set(this.callback, target);
    }
    disconnect() {
      mutationCallbacks.delete(this.callback);
    }
  }

  class FakePerformanceObserver {
    static supportedEntryTypes = options.supportedEntryTypes ?? [
      "longtask",
      "long-animation-frame",
      "resource",
    ];
    private readonly callback: EntryCallback;
    private type: string | null = null;
    constructor(callback: EntryCallback) {
      this.callback = callback;
    }
    observe(init: { type: string }) {
      this.type = init.type;
      entryCallbacks.set(init.type, this.callback);
    }
    disconnect() {
      if (this.type !== null) {
        entryCallbacks.delete(this.type);
      }
    }
  }

  class FakeWebSocket {
    private readonly listeners: MessageListener[] = [];
    constructor() {
      sockets.push(this);
    }
    addEventListener(type: string, listener: MessageListener) {
      if (type === "message") {
        this.listeners.push(listener);
      }
    }
    receive(data: unknown) {
      for (const listener of this.listeners) {
        listener({ data });
      }
    }
  }

  const context: Record<string, unknown> = {
    document,
    requestAnimationFrame: (callback: (now: number) => void) => {
      const handle = nextHandle;
      nextHandle += 1;
      frameCallbacks.set(handle, callback);
      return handle;
    },
    cancelAnimationFrame: (handle: number) => {
      frameCallbacks.delete(handle);
    },
    MutationObserver: FakeMutationObserver,
    PerformanceObserver: FakePerformanceObserver,
    WebSocket: FakeWebSocket,
    performance: { now: () => performanceNow, timeOrigin: 42 },
    Date: { now: () => epochNow },
  };
  if (options.existingHook !== undefined) {
    context.__REACT_DEVTOOLS_GLOBAL_HOOK__ = options.existingHook;
  }
  context.window = context;
  runInNewContext(collectorSource, context);

  return {
    context,
    document,
    bench: readBench(context),
    get root() {
      return root;
    },
    get rootQueries() {
      return rootQueries;
    },
    get messageReads() {
      return messageReads;
    },
    failNextRead: () => {
      failNextRead = true;
    },
    mountRoot: () => {
      rootMounted = true;
      notifyMutation(false);
    },
    mutateOutsideRoot: () => notifyMutation(false),
    observedTargets,
    frameCallbacks,
    mutationCallbacks,
    sockets,
    install: () => runInNewContext(collectorSource, context),
    evaluate: (expression: string): unknown =>
      runInNewContext(expression, context),
    flushFrame: () => {
      performanceNow += 16;
      epochNow += 16;
      const callbacks = [...frameCallbacks.values()];
      frameCallbacks.clear();
      for (const callback of callbacks) {
        callback(performanceNow);
      }
      return epochNow;
    },
    setText: (text: string) => {
      root.message.textContent = text;
      notifyMutation(true);
    },
    replaceRoot: () => {
      root.isConnected = false;
      root = makeRoot();
      return root;
    },
    emitEntries: (type: string, entries: unknown[]) => {
      entryCallbacks.get(type)?.({ getEntries: () => entries });
    },
    newSocket: () => {
      const Constructor = context.WebSocket;
      if (typeof Constructor !== "function") {
        throw new Error("WebSocket is not a constructor");
      }
      Reflect.construct(Constructor, ["ws://127.0.0.1/api/v1/ws"]);
      const socket = sockets.at(-1);
      if (socket === undefined) {
        throw new Error("socket was not constructed");
      }
      return socket;
    },
  };
}

const START_OPTIONS = {
  messageSelector: ".message",
  rootSelector: "#root",
  checkpoints: ["alpha beta", "gamma", "alpha beta"],
};

describe("collector source", () => {
  it("samples text on dirty frames and hits checkpoints in order with repeated phrases", () => {
    const page = createPage();
    page.bench.start(START_OPTIONS);
    const firstFrameEpoch = page.flushFrame();

    page.setText("alpha beta");
    const firstHitEpoch = page.flushFrame();
    expect(collectorProgressSchema.parse(page.bench.progress())).toEqual({
      textLength: 10,
      checkpointHits: 1,
      checkpoints: 3,
    });

    page.setText("alpha beta alpha beta");
    page.flushFrame();
    expect(
      collectorProgressSchema.parse(page.bench.progress()).checkpointHits,
    ).toBe(1);

    page.flushFrame();
    page.setText("alpha beta alpha beta gamma");
    const lastHitEpoch = page.flushFrame();
    expect(collectorProgressSchema.parse(page.bench.progress())).toEqual({
      textLength: 27,
      checkpointHits: 3,
      checkpoints: 3,
    });

    const result = collectorResultSchema.parse(page.bench.stop());
    expect(result.frames).toEqual([16, 32, 48, 64, 80]);
    expect(result.samples).toEqual([
      [firstFrameEpoch, 0],
      [firstHitEpoch, 10],
      [firstHitEpoch + 16, 21],
      [lastHitEpoch, 27],
    ]);
    expect(result.checkpointHits).toEqual([
      firstHitEpoch,
      lastHitEpoch,
      lastHitEpoch,
    ]);
    expect(result.checkpoints).toEqual(START_OPTIONS.checkpoints);
    expect(result.rootFound).toBe(true);
    expect(result.timeOrigin).toBe(42);
    expect(page.frameCallbacks.size).toBe(0);
    expect(page.mutationCallbacks.size).toBe(0);
  });

  it("does not hit a repeated phrase until its next occurrence renders", () => {
    const page = createPage();
    page.bench.start({
      ...START_OPTIONS,
      checkpoints: ["alpha beta", "alpha beta"],
    });
    page.setText("alpha beta, then more words");
    page.flushFrame();
    expect(
      collectorProgressSchema.parse(page.bench.progress()).checkpointHits,
    ).toBe(1);
    page.setText("alpha betalpha beta");
    page.flushFrame();
    expect(
      collectorProgressSchema.parse(page.bench.progress()).checkpointHits,
    ).toBe(1);
    page.setText("alpha beta alpha beta");
    page.flushFrame();
    expect(
      collectorProgressSchema.parse(page.bench.progress()).checkpointHits,
    ).toBe(2);
  });

  it("counts React commits and WebSocket payload bytes only while recording", () => {
    const page = createPage();
    const hook = readHook(page.context);
    const socket = page.newSocket();
    hook.onCommitFiberRoot();
    socket.receive("before start");

    page.bench.start(START_OPTIONS);
    hook.onCommitFiberRoot();
    hook.onCommitFiberRoot();
    socket.receive("hé");
    socket.receive("\u{1F600}");
    socket.receive(page.evaluate("new ArrayBuffer(8)"));
    const result = collectorResultSchema.parse(page.bench.stop());

    socket.receive("after stop");
    hook.onCommitFiberRoot();
    expect(result.reactHookInstalled).toBe(true);
    expect(result.commits).toBe(2);
    expect(result.commitTimes).toHaveLength(2);
    expect(result.wsMessages).toBe(3);
    expect(result.wsBytes).toBe(3 + 4 + 8);
  });

  it("leaves an existing DevTools hook in place and installs only once", () => {
    const existingHook = { renderers: new Map(), supportsFiber: true };
    const page = createPage({ existingHook });
    expect(page.context.__REACT_DEVTOOLS_GLOBAL_HOOK__).toBe(existingHook);
    const firstInstance = page.context.__bbStreamBench;
    page.install();
    expect(page.context.__bbStreamBench).toBe(firstInstance);
    page.bench.start(START_OPTIONS);
    const result = collectorResultSchema.parse(page.bench.stop());
    expect(result.reactHookInstalled).toBe(false);
  });

  it("records long tasks, attributed long animation frames and API resources", () => {
    const page = createPage({
      supportedEntryTypes: ["longtask", "resource", "long-animation-frame"],
    });
    page.bench.start(START_OPTIONS);
    page.emitEntries("longtask", [{ startTime: 100, duration: 80 }]);
    page.emitEntries("long-animation-frame", [
      {
        startTime: 90,
        duration: 120,
        blockingDuration: 70,
        renderStart: 190,
        styleAndLayoutStart: 200,
        scripts: [
          {
            startTime: 95,
            duration: 60,
            invoker: "FrameRequestCallback",
            invokerType: "user-callback",
            sourceURL: "http://127.0.0.1/assets/index.js",
            sourceFunctionName: "renderMarkdown",
            sourceCharPosition: 1234,
            forcedStyleAndLayoutDuration: 3,
          },
          { startTime: 160, duration: 5 },
        ],
      },
    ]);
    page.emitEntries("resource", [
      {
        name: "http://127.0.0.1/api/v1/threads/thr_a2b3c4d5e6/timeline?afterSequence=4",
        initiatorType: "fetch",
        startTime: 10,
        duration: 12,
        transferSize: 900,
        encodedBodySize: 600,
        decodedBodySize: 2400,
        responseStatus: 200,
      },
      { name: "http://127.0.0.1/assets/index.js", startTime: 1, duration: 2 },
    ]);
    const result = collectorResultSchema.parse(page.bench.stop());
    expect(result.unsupportedEntryTypes).toEqual([]);
    expect(result.longTasks).toEqual([[100, 80]]);
    expect(result.loafs).toHaveLength(1);
    expect(result.loafs[0]?.scripts[1]).toEqual({
      startTime: 160,
      duration: 5,
      invoker: "",
      invokerType: "",
      sourceURL: "",
      sourceFunctionName: "",
      sourceCharPosition: -1,
      forcedStyleAndLayoutDuration: 0,
    });
    expect(result.resources.map((resource) => resource.name)).toEqual([
      "http://127.0.0.1/api/v1/threads/thr_a2b3c4d5e6/timeline?afterSequence=4",
    ]);
  });

  it("notes unsupported entry types instead of throwing", () => {
    const page = createPage({ supportedEntryTypes: ["resource"] });
    page.bench.start(START_OPTIONS);
    const result = collectorResultSchema.parse(page.bench.stop());
    expect(result.unsupportedEntryTypes).toEqual([
      "longtask",
      "long-animation-frame",
    ]);
  });

  it("rebinds the mutation observer when the root element is replaced", () => {
    const page = createPage();
    page.bench.start(START_OPTIONS);
    page.flushFrame();
    const replacement = page.replaceRoot();
    page.flushFrame();
    expect(page.observedTargets.at(-1)).toBe(replacement);
    page.setText("alpha beta");
    page.flushFrame();
    expect(collectorProgressSchema.parse(page.bench.progress())).toMatchObject({
      textLength: 10,
      checkpointHits: 1,
    });
  });

  it("waits for a root that mounts after start without reading text outside it", () => {
    const page = createPage({ rootMounted: false });
    page.bench.start(START_OPTIONS);
    expect(page.observedTargets.at(-1)).toBe(page.document);
    page.flushFrame();
    page.flushFrame();
    const queriesWhileIdle = page.rootQueries;
    page.flushFrame();
    expect(page.rootQueries).toBe(queriesWhileIdle);
    page.mutateOutsideRoot();
    page.flushFrame();
    expect(page.rootQueries).toBe(queriesWhileIdle + 1);
    expect(page.messageReads).toBe(0);

    page.mountRoot();
    page.flushFrame();
    expect(page.observedTargets.at(-1)).toBe(page.root);
    expect(page.messageReads).toBe(1);
    const readsAfterMount = page.messageReads;
    page.mutateOutsideRoot();
    page.flushFrame();
    expect(page.messageReads).toBe(readsAfterMount);

    page.setText("alpha beta");
    page.flushFrame();
    expect(collectorProgressSchema.parse(page.bench.progress())).toMatchObject({
      textLength: 10,
      checkpointHits: 1,
    });
    const result = collectorResultSchema.parse(page.bench.stop());
    expect(result.rootFound).toBe(true);
  });

  it("reports rootFound false when the root never mounts", () => {
    const page = createPage({ rootMounted: false });
    page.bench.start(START_OPTIONS);
    page.mutateOutsideRoot();
    page.flushFrame();
    const result = collectorResultSchema.parse(page.bench.stop());
    expect(result.rootFound).toBe(false);
    expect(result.samples).toEqual([]);
    expect(page.messageReads).toBe(0);
  });

  it("rejects invalid selectors synchronously and keeps the current recording", () => {
    const page = createPage();
    page.bench.start(START_OPTIONS);
    expect(() =>
      page.bench.start({ ...START_OPTIONS, messageSelector: "div[[" }),
    ).toThrow("messageSelector is not a valid selector");
    expect(() =>
      page.bench.start({ ...START_OPTIONS, rootSelector: "main[[" }),
    ).toThrow("rootSelector is not a valid selector");
    page.setText("alpha beta");
    page.flushFrame();
    expect(
      collectorProgressSchema.parse(page.bench.progress()).checkpointHits,
    ).toBe(1);
  });

  it("keeps recording frames after a sampling error and surfaces it from progress and stop", () => {
    const page = createPage();
    page.bench.start(START_OPTIONS);
    page.failNextRead();
    page.flushFrame();
    page.setText("alpha beta");
    page.flushFrame();
    expect(page.frameCallbacks.size).toBe(1);
    expect(() => page.bench.progress()).toThrow(
      "frame sampling failed 1 time(s)",
    );
    expect(() => page.bench.stop()).toThrow("message read failed");
    expect(page.frameCallbacks.size).toBe(0);
  });

  it("rejects malformed start options and stop before start", () => {
    const page = createPage();
    expect(() => page.bench.stop()).toThrow("stop called before start");
    expect(() =>
      page.bench.start({ selector: ".message", checkpoints: [] }),
    ).toThrow("__bbStreamBench.start expects");
    expect(() =>
      page.bench.start({ ...START_OPTIONS, checkpoints: [""] }),
    ).toThrow("__bbStreamBench.start expects");
  });
});
