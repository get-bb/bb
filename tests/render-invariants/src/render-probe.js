(() => {
  const PERFORMED_WORK = 1;
  const HOST_COMPONENT = 5;
  const HOST_TEXT = 6;
  const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15]);
  const SIDEBAR_THREAD_LINK = "a[data-sidebar-thread-id]";
  const TIMELINE_ROW = "[data-timeline-row-id]";

  const state = {
    commits: 0,
    commitsSinceLoad: 0,
    lastCommitAt: 0,
    renders: [],
    errors: [],
  };

  function componentName(fiber) {
    const type = fiber.type;
    if (type === null || type === undefined) return "Anonymous";
    if (fiber.tag === 11) {
      const render = type.render;
      return (
        type.displayName ||
        (render && (render.displayName || render.name)) ||
        "ForwardRef"
      );
    }
    if (fiber.tag === 14) {
      const inner = type.type;
      return (
        type.displayName ||
        (inner && (inner.displayName || inner.name)) ||
        "Memo"
      );
    }
    return type.displayName || type.name || "Anonymous";
  }

  function topLevelHostNodes(fiber) {
    const nodes = [];
    const stack = [fiber.child];
    while (stack.length > 0) {
      const next = stack.pop();
      if (next === null || next === undefined) continue;
      stack.push(next.sibling);
      if (next.tag === HOST_COMPONENT) {
        nodes.push(next.stateNode);
      } else if (next.tag === HOST_TEXT) {
        if (next.stateNode.parentElement !== null) {
          nodes.push(next.stateNode.parentElement);
        }
      } else {
        stack.push(next.child);
      }
    }
    if (nodes.length > 0) return nodes;
    for (let parent = fiber.return; parent !== null; parent = parent.return) {
      if (parent.tag === HOST_COMPONENT) return [parent.stateNode];
    }
    return [];
  }

  function sidebarThreadOf(element) {
    for (let scope = element; scope !== null; scope = scope.parentElement) {
      const links = scope.querySelectorAll(SIDEBAR_THREAD_LINK);
      if (links.length === 1) {
        return links[0].getAttribute("data-sidebar-thread-id");
      }
      if (links.length > 1) return null;
    }
    return null;
  }

  function timelineRowOf(element) {
    const row = element.closest(TIMELINE_ROW);
    return row === null ? null : row.getAttribute("data-timeline-row-id");
  }

  function sole(nodes, regionOf) {
    let region;
    for (const node of nodes) {
      const next = regionOf(node);
      if (next === null) return null;
      if (region === undefined) region = next;
      else if (region !== next) return null;
    }
    return region ?? null;
  }

  function describe(fiber, mounted) {
    const nodes = topLevelHostNodes(fiber);
    return {
      name: componentName(fiber),
      mounted,
      nodes,
      sidebarThreadId: sole(nodes, sidebarThreadOf),
      timelineRowId: sole(nodes, timelineRowOf),
    };
  }

  function collect(root) {
    const stack = [root];
    while (stack.length > 0) {
      const fiber = stack.pop();
      const previous = fiber.alternate;
      if (COMPONENT_TAGS.has(fiber.tag)) {
        const mounted = previous === null;
        if (mounted || (fiber.flags & PERFORMED_WORK) === PERFORMED_WORK) {
          state.renders.push(describe(fiber, mounted));
        }
      }
      if (previous !== null && fiber.child === previous.child) continue;
      for (let child = fiber.child; child !== null; child = child.sibling) {
        stack.push(child);
      }
    }
  }

  let nextRendererId = 1;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map(),
    supportsFiber: true,
    checkDCE() {},
    inject(renderer) {
      const id = nextRendererId++;
      this.renderers.set(id, renderer);
      return id;
    },
    onScheduleFiberRoot() {},
    onCommitFiberRoot(_id, root) {
      try {
        state.commits += 1;
        state.commitsSinceLoad += 1;
        state.lastCommitAt = performance.now();
        collect(root.current);
      } catch (error) {
        state.errors.push(String(error));
      }
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    setStrictMode() {},
  };

  function locate(render) {
    if (render.sidebarThreadId !== null)
      return `sidebar row ${render.sidebarThreadId}`;
    if (render.timelineRowId !== null)
      return `timeline row ${render.timelineRowId}`;
    const node = render.nodes[0];
    if (node === undefined) return "no DOM";
    const label = node.getAttribute("aria-label");
    if (label !== null)
      return `<${node.tagName.toLowerCase()} aria-label="${label}">`;
    const className = typeof node.className === "string" ? node.className : "";
    return `<${node.tagName.toLowerCase()} class="${className.slice(0, 48)}">`;
  }

  window.__renderProbe = {
    reset() {
      state.commits = 0;
      state.renders = [];
    },
    quietFor() {
      return performance.now() - state.lastCommitAt;
    },
    renderCount() {
      return state.renders.length;
    },
    report(containerSelector, since) {
      const container =
        containerSelector === null
          ? null
          : document.querySelector(containerSelector);
      if (containerSelector !== null && container === null) {
        throw new Error(`No element matches ${containerSelector}`);
      }
      return {
        commits: state.commits,
        commitsSinceLoad: state.commitsSinceLoad,
        errors: state.errors,
        renders: state.renders.slice(since).map((render) => ({
          name: render.name,
          mounted: render.mounted,
          sidebarThreadId: render.sidebarThreadId,
          timelineRowId: render.timelineRowId,
          location: locate(render),
          insideContainer:
            container !== null &&
            render.nodes.length > 0 &&
            render.nodes.every((node) => container.contains(node)),
        })),
      };
    },
  };
})();
