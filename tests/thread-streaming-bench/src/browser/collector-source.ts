export const collectorSource = `(() => {
  const state = {
    recording: false,
    messageSelector: "",
    rootSelector: "",
    root: null,
    checkpoints: [],
    occurrences: [],
    checkpointHits: [],
    commits: 0,
    frames: [],
    longTasks: [],
    loafs: [],
    samples: [],
    dirty: false,
    addedNodes: 0,
    removedNodes: 0,
    lastTextLength: -1,
    rafHandle: 0,
    mutationObserver: null,
    observers: [],
  };

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
      }
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
  };

  function markDirty(records) {
    state.dirty = true;
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
    state.mutationObserver.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
    });
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
    if (!state.root.isConnected) {
      const root = document.querySelector(state.rootSelector);
      if (root === null) {
        return;
      }
      bindRoot(root);
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
    state.rafHandle = requestAnimationFrame(frame);
    state.frames.push(now);
    sampleFrame();
  }

  function observeEntries(type, onEntry) {
    const observer = new PerformanceObserver((list) => {
      if (state.recording) {
        list.getEntries().forEach(onEntry);
      }
    });
    observer.observe({ type, buffered: false });
    state.observers.push(observer);
  }

  window.__bbStreamBench = {
    start(options) {
      const root = document.querySelector(options.rootSelector);
      if (root === null) {
        throw new Error("__bbStreamBench.start found no " + options.rootSelector);
      }
      state.recording = true;
      state.messageSelector = options.messageSelector;
      state.rootSelector = options.rootSelector;
      state.checkpoints = options.checkpoints;
      const seen = new Map();
      state.occurrences = state.checkpoints.map((phrase) => {
        const count = (seen.get(phrase) ?? 0) + 1;
        seen.set(phrase, count);
        return count;
      });
      bindRoot(root);
      observeEntries("longtask", (entry) => {
        state.longTasks.push([entry.startTime, entry.duration]);
      });
      observeEntries("long-animation-frame", (entry) => {
        state.loafs.push({
          duration: entry.duration,
          blockingDuration: entry.blockingDuration,
          scripts: entry.scripts.map((script) => ({
            duration: script.duration,
            invoker: script.invoker,
            sourceURL: script.sourceURL,
            sourceFunctionName: script.sourceFunctionName,
            forcedStyleAndLayoutDuration: script.forcedStyleAndLayoutDuration,
          })),
        });
      });
      state.rafHandle = requestAnimationFrame(frame);
    },
    progress() {
      return {
        textLength: Math.max(state.lastTextLength, 0),
        checkpointHits: state.checkpointHits.length,
        checkpoints: state.checkpoints.length,
      };
    },
    stop() {
      state.recording = false;
      cancelAnimationFrame(state.rafHandle);
      state.mutationObserver.disconnect();
      for (const observer of state.observers) {
        observer.disconnect();
      }
      return {
        commits: state.commits,
        frames: state.frames,
        longTasks: state.longTasks,
        loafs: state.loafs,
        checkpointHits: state.checkpointHits,
        samples: state.samples,
        addedNodes: state.addedNodes,
        removedNodes: state.removedNodes,
      };
    },
  };
})();
`;
