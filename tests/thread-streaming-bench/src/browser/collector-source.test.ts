import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  readCollectorProgress,
  startCollector,
  stopCollector,
} from "./collector.js";
import { collectorSource } from "./collector-source.js";

type EntryCallback = (list: { getEntries: () => unknown[] }) => void;
type MutationCallback = (records: unknown[]) => void;

function createPage() {
  let now = 0;
  let nextHandle = 1;
  let messageReads = 0;
  const frameCallbacks = new Map<number, (now: number) => void>();
  const mutationCallbacks = new Map<MutationCallback, unknown>();
  const entryCallbacks = new Map<string, EntryCallback>();
  const makeRoot = () => {
    const message = { textContent: "" };
    return {
      isConnected: true,
      message,
      querySelectorAll: () => {
        messageReads += 1;
        return [message];
      },
    };
  };
  let root = makeRoot();

  class FakeMutationObserver {
    private readonly callback: MutationCallback;
    constructor(callback: MutationCallback) {
      this.callback = callback;
    }
    observe(target: unknown) {
      mutationCallbacks.set(this.callback, target);
    }
    disconnect() {
      mutationCallbacks.delete(this.callback);
    }
  }

  class FakePerformanceObserver {
    private readonly callback: EntryCallback;
    private type = "";
    constructor(callback: EntryCallback) {
      this.callback = callback;
    }
    observe(init: { type: string }) {
      this.type = init.type;
      entryCallbacks.set(init.type, this.callback);
    }
    disconnect() {
      entryCallbacks.delete(this.type);
    }
  }

  const context: Record<string, unknown> = {
    document: {
      querySelector: (selector: string) => (selector === "#root" ? root : null),
    },
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
    Date: { now: () => now },
  };
  context.window = context;
  runInNewContext(collectorSource, context);

  return {
    page: {
      evaluate: async (expression: string): Promise<unknown> =>
        runInNewContext(expression, context),
    },
    frameCallbacks,
    mutationCallbacks,
    messageReads: () => messageReads,
    commit: () =>
      runInNewContext(
        "window.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot()",
        context,
      ),
    flushFrame: () => {
      now += 16;
      const callbacks = [...frameCallbacks.values()];
      frameCallbacks.clear();
      for (const callback of callbacks) {
        callback(now);
      }
    },
    setText: (text: string) => {
      root.message.textContent = text;
      for (const [callback, target] of [...mutationCallbacks]) {
        if (target === root) {
          callback([]);
        }
      }
    },
    replaceRoot: () => {
      root.isConnected = false;
      root = makeRoot();
    },
    emitEntries: (type: string, entries: unknown[]) => {
      entryCallbacks.get(type)?.({ getEntries: () => entries });
    },
  };
}

const START_OPTIONS = {
  messageSelector: ".message",
  rootSelector: "#root",
  checkpoints: ["alpha beta", "gamma", "alpha beta"],
};

describe("collector source", () => {
  it("samples text on dirty frames and hits checkpoints in order with repeated phrases", async () => {
    const {
      flushFrame,
      frameCallbacks,
      messageReads,
      mutationCallbacks,
      page,
      setText,
    } = createPage();
    await startCollector(page, START_OPTIONS);
    flushFrame();
    setText("alpha beta");
    flushFrame();
    expect(await readCollectorProgress(page)).toEqual({
      textLength: 10,
      checkpointHits: 1,
      checkpoints: 3,
    });
    setText("alpha beta alpha beta");
    flushFrame();
    expect((await readCollectorProgress(page)).checkpointHits).toBe(1);
    flushFrame();
    setText("alpha beta alpha beta gamma");
    flushFrame();
    expect(await readCollectorProgress(page)).toEqual({
      textLength: 27,
      checkpointHits: 3,
      checkpoints: 3,
    });

    const result = await stopCollector(page);
    expect(result.frames).toEqual([16, 32, 48, 64, 80]);
    expect(result.samples).toEqual([
      [16, 0],
      [32, 10],
      [48, 21],
      [80, 27],
    ]);
    expect(result.checkpointHits).toEqual([32, 80, 80]);
    expect(messageReads()).toBe(4);
    expect(frameCallbacks.size).toBe(0);
    expect(mutationCallbacks.size).toBe(0);
  });

  it("does not hit a repeated phrase until its next occurrence renders", async () => {
    const { flushFrame, page, setText } = createPage();
    await startCollector(page, {
      ...START_OPTIONS,
      checkpoints: ["alpha beta", "alpha beta"],
    });
    setText("alpha beta, then more words");
    flushFrame();
    expect((await readCollectorProgress(page)).checkpointHits).toBe(1);
    setText("alpha betalpha beta");
    flushFrame();
    expect((await readCollectorProgress(page)).checkpointHits).toBe(1);
    setText("alpha beta alpha beta");
    flushFrame();
    expect((await readCollectorProgress(page)).checkpointHits).toBe(2);
  });

  it("counts React commits only while recording and records long tasks and attributed long animation frames", async () => {
    const { commit, emitEntries, page } = createPage();
    commit();
    await startCollector(page, START_OPTIONS);
    commit();
    commit();
    emitEntries("longtask", [{ startTime: 100, duration: 80 }]);
    const script = {
      duration: 60,
      invoker: "FrameRequestCallback",
      sourceURL: "http://127.0.0.1/assets/index.js",
      sourceFunctionName: "renderMarkdown",
      forcedStyleAndLayoutDuration: 3,
    };
    emitEntries("long-animation-frame", [
      {
        startTime: 90,
        duration: 120,
        blockingDuration: 70,
        renderStart: 190,
        scripts: [{ ...script, startTime: 95, invokerType: "user-callback" }],
      },
    ]);
    const result = await stopCollector(page);
    expect(result.commits).toBe(2);
    expect(result.longTasks).toEqual([[100, 80]]);
    expect(result.loafs).toEqual([
      { duration: 120, blockingDuration: 70, scripts: [script] },
    ]);
  });

  it("rebinds to a root element that replaced the original", async () => {
    const { flushFrame, page, replaceRoot, setText } = createPage();
    await startCollector(page, START_OPTIONS);
    flushFrame();
    replaceRoot();
    flushFrame();
    setText("alpha beta");
    flushFrame();
    expect(await readCollectorProgress(page)).toMatchObject({
      textLength: 10,
      checkpointHits: 1,
    });
  });
});
