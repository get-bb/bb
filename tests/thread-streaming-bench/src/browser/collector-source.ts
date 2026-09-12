export const collectorSource = `(() => {
  if (window.__bbStreamBench !== undefined) {
    return;
  }

  const state = {
    recording: false,
    startedAt: 0,
    messageSelector: "",
    rootSelector: "",
    root: null,
    rootFound: false,
    checkpoints: [],
    occurrences: [],
    checkpointHits: [],
    commits: 0,
    commitTimes: [],
    frames: [],
    longTasks: [],
    loafs: [],
    resources: [],
    wsMessages: 0,
    wsBytes: 0,
    samples: [],
    dirty: false,
    addedNodes: 0,
    removedNodes: 0,
    lastTextLength: -1,
    rafHandle: 0,
    mutationObserver: null,
    observers: [],
    unsupportedEntryTypes: [],
    frameErrorCount: 0,
    firstFrameError: null,
  };

  let reactHookInstalled = false;
  if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__ === undefined) {
    const renderers = new Map();
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      renderers,
      supportsFiber: true,
      isDisabled: false,
      inject(renderer) {
        const id = renderers.size + 1;
        renderers.set(id, renderer);
        return id;
      },
      onScheduleFiberRoot() {},
      onCommitFiberRoot() {
        if (state.recording) {
          state.commits += 1;
          state.commitTimes.push(performance.now());
        }
      },
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
      checkDCE() {},
    };
    reactHookInstalled = true;
  }

  function utf8Length(text) {
    let bytes = text.length;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code < 0x80) {
        continue;
      }
      if (code < 0x800) {
        bytes += 1;
        continue;
      }
      if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
        const next = text.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          bytes += 2;
          index += 1;
          continue;
        }
      }
      bytes += 2;
    }
    return bytes;
  }

  const NativeWebSocket = window.WebSocket;
  if (typeof NativeWebSocket === "function") {
    class CountingWebSocket extends NativeWebSocket {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", (event) => {
          if (!state.recording) {
            return;
          }
          state.wsMessages += 1;
          const data = event.data;
          if (typeof data === "string") {
            state.wsBytes += utf8Length(data);
          } else if (data instanceof ArrayBuffer) {
            state.wsBytes += data.byteLength;
          } else if (typeof Blob === "function" && data instanceof Blob) {
            state.wsBytes += data.size;
          }
        });
      }
    }
    window.WebSocket = CountingWebSocket;
  }

  function markDirty(records) {
    state.dirty = true;
    if (!state.recording || !Array.isArray(records)) {
      return;
    }
    for (const record of records) {
      state.addedNodes += record.addedNodes.length;
      state.removedNodes += record.removedNodes.length;
    }
  }

  function bindRoot(root) {
    if (state.mutationObserver !== null) {
      state.mutationObserver.disconnect();
    }
    state.root = root;
    state.mutationObserver = new MutationObserver(markDirty);
    if (root === null) {
      state.mutationObserver.observe(document, {
        subtree: true,
        childList: true,
      });
    } else {
      state.rootFound = true;
      state.mutationObserver.observe(root, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    }
    state.dirty = true;
  }

  function lastMessageText() {
    const matches = state.root.querySelectorAll(state.messageSelector);
    const last = matches[matches.length - 1];
    return last === undefined ? "" : (last.textContent ?? "");
  }

  function hasOccurrences(text, phrase, count) {
    let from = 0;
    for (let found = 0; found < count; found += 1) {
      const index = text.indexOf(phrase, from);
      if (index === -1) {
        return false;
      }
      from = index + phrase.length;
    }
    return true;
  }

  function sampleFrame() {
    if (state.root === null) {
      if (!state.dirty) {
        return;
      }
      state.dirty = false;
      const root = document.querySelector(state.rootSelector);
      if (root === null) {
        return;
      }
      bindRoot(root);
    } else if (!state.root.isConnected) {
      bindRoot(document.querySelector(state.rootSelector));
      if (state.root === null) {
        return;
      }
    }
    if (!state.dirty) {
      return;
    }
    state.dirty = false;
    const text = lastMessageText();
    const epoch = Date.now();
    if (text.length !== state.lastTextLength) {
      state.lastTextLength = text.length;
      state.samples.push([epoch, text.length]);
    }
    while (state.checkpointHits.length < state.checkpoints.length) {
      const index = state.checkpointHits.length;
      if (!hasOccurrences(text, state.checkpoints[index], state.occurrences[index])) {
        break;
      }
      state.checkpointHits.push(epoch);
    }
  }

  function frame(now) {
    if (!state.recording) {
      return;
    }
    state.rafHandle = requestAnimationFrame(frame);
    state.frames.push(now);
    try {
      sampleFrame();
    } catch (error) {
      state.frameErrorCount += 1;
      if (state.firstFrameError === null) {
        state.firstFrameError = String(error && error.stack ? error.stack : error);
      }
    }
  }

  function assertNoFrameErrors() {
    if (state.frameErrorCount > 0) {
      throw new Error(
        "__bbStreamBench frame sampling failed " + state.frameErrorCount + " time(s): " + state.firstFrameError,
      );
    }
  }

  function assertValidSelector(name, selector) {
    try {
      document.querySelector(selector);
    } catch (error) {
      throw new TypeError(
        "__bbStreamBench.start " + name + " is not a valid selector: " + JSON.stringify(selector) + " (" + String(error && error.message ? error.message : error) + ")",
      );
    }
  }

  function disconnectObservers() {
    if (state.rafHandle !== 0) {
      cancelAnimationFrame(state.rafHandle);
      state.rafHandle = 0;
    }
    if (state.mutationObserver !== null) {
      state.mutationObserver.disconnect();
      state.mutationObserver = null;
    }
    for (const observer of state.observers) {
      observer.disconnect();
    }
    state.observers = [];
  }

  function observeEntries(type, onEntry) {
    const supported = PerformanceObserver.supportedEntryTypes ?? [];
    if (!supported.includes(type)) {
      state.unsupportedEntryTypes.push(type);
      return;
    }
    const observer = new PerformanceObserver((list) => {
      if (!state.recording) {
        return;
      }
      for (const entry of list.getEntries()) {
        onEntry(entry);
      }
    });
    observer.observe({ type, buffered: false });
    state.observers.push(observer);
  }

  function numberOr(value, fallback) {
    return typeof value === "number" ? value : fallback;
  }

  function stringOr(value, fallback) {
    return typeof value === "string" ? value : fallback;
  }

  window.__bbStreamBench = {
    start(options) {
      if (
        options === null ||
        typeof options !== "object" ||
        typeof options.messageSelector !== "string" ||
        typeof options.rootSelector !== "string" ||
        !Array.isArray(options.checkpoints) ||
        !options.checkpoints.every((phrase) => typeof phrase === "string" && phrase.length > 0)
      ) {
        throw new TypeError(
          "__bbStreamBench.start expects { messageSelector: string, rootSelector: string, checkpoints: non-empty string[] entries }",
        );
      }
      assertValidSelector("messageSelector", options.messageSelector);
      assertValidSelector("rootSelector", options.rootSelector);
      disconnectObservers();
      state.recording = true;
      state.startedAt = Date.now();
      state.messageSelector = options.messageSelector;
      state.rootSelector = options.rootSelector;
      state.rootFound = false;
      state.checkpoints = options.checkpoints.slice();
      const seen = new Map();
      state.occurrences = state.checkpoints.map((phrase) => {
        const count = (seen.get(phrase) ?? 0) + 1;
        seen.set(phrase, count);
        return count;
      });
      state.checkpointHits = [];
      state.commits = 0;
      state.commitTimes = [];
      state.frames = [];
      state.longTasks = [];
      state.loafs = [];
      state.resources = [];
      state.wsMessages = 0;
      state.wsBytes = 0;
      state.samples = [];
      state.addedNodes = 0;
      state.removedNodes = 0;
      state.lastTextLength = -1;
      state.unsupportedEntryTypes = [];
      state.frameErrorCount = 0;
      state.firstFrameError = null;
      bindRoot(document.querySelector(state.rootSelector));
      observeEntries("longtask", (entry) => {
        state.longTasks.push([entry.startTime, entry.duration]);
      });
      observeEntries("long-animation-frame", (entry) => {
        const scripts = Array.isArray(entry.scripts) ? entry.scripts : [];
        state.loafs.push({
          startTime: entry.startTime,
          duration: entry.duration,
          blockingDuration: numberOr(entry.blockingDuration, 0),
          renderStart: numberOr(entry.renderStart, 0),
          styleAndLayoutStart: numberOr(entry.styleAndLayoutStart, 0),
          scripts: scripts.map((script) => ({
            startTime: script.startTime,
            duration: script.duration,
            invoker: stringOr(script.invoker, ""),
            invokerType: stringOr(script.invokerType, ""),
            sourceURL: stringOr(script.sourceURL, ""),
            sourceFunctionName: stringOr(script.sourceFunctionName, ""),
            sourceCharPosition: numberOr(script.sourceCharPosition, -1),
            forcedStyleAndLayoutDuration: numberOr(script.forcedStyleAndLayoutDuration, 0),
          })),
        });
      });
      observeEntries("resource", (entry) => {
        if (!entry.name.includes("/api/")) {
          return;
        }
        state.resources.push({
          name: entry.name,
          initiatorType: stringOr(entry.initiatorType, ""),
          startTime: entry.startTime,
          duration: entry.duration,
          transferSize: numberOr(entry.transferSize, 0),
          encodedBodySize: numberOr(entry.encodedBodySize, 0),
          decodedBodySize: numberOr(entry.decodedBodySize, 0),
          responseStatus: numberOr(entry.responseStatus, 0),
        });
      });
      state.rafHandle = requestAnimationFrame(frame);
      return { startedAt: state.startedAt };
    },
    progress() {
      assertNoFrameErrors();
      return {
        textLength: Math.max(state.lastTextLength, 0),
        checkpointHits: state.checkpointHits.length,
        checkpoints: state.checkpoints.length,
      };
    },
    stop() {
      if (state.startedAt === 0) {
        throw new Error("__bbStreamBench.stop called before start");
      }
      state.recording = false;
      disconnectObservers();
      assertNoFrameErrors();
      return {
        reactHookInstalled,
        rootFound: state.rootFound,
        unsupportedEntryTypes: state.unsupportedEntryTypes.slice(),
        timeOrigin: performance.timeOrigin,
        startedAt: state.startedAt,
        stoppedAt: Date.now(),
        commits: state.commits,
        commitTimes: state.commitTimes,
        frames: state.frames,
        longTasks: state.longTasks,
        loafs: state.loafs,
        resources: state.resources,
        wsMessages: state.wsMessages,
        wsBytes: state.wsBytes,
        checkpoints: state.checkpoints,
        checkpointHits: state.checkpointHits,
        samples: state.samples,
        addedNodes: state.addedNodes,
        removedNodes: state.removedNodes,
      };
    },
  };
})();
`;
