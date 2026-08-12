// @vitest-environment jsdom
import { createRoot } from "react-dom/client";
import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  foreignDomMutationCount,
  installForeignDomMutationGuard,
  uninstallForeignDomMutationGuardForTest,
} from "./foreign-dom-mutation-guard";

afterEach(() => {
  uninstallForeignDomMutationGuardForTest();
  vi.restoreAllMocks();
});

/**
 * Reproduces the reported crash: React mounts a node, something outside React
 * reparents it, and React's next unmount of that node calls
 * `originalParent.removeChild(node)`. Returns the errors React escalated to the
 * root, which is what tears the whole app down when nothing catches them.
 */
function unmountAfterForeignReparent(): Error[] {
  const errors: Error[] = [];
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container, {
    onUncaughtError: (error) => {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    },
  });

  function Tree({ mounted }: { mounted: boolean }) {
    return <div>{mounted ? <p data-moved="">body</p> : null}</div>;
  }

  act(() => root.render(<Tree mounted />));
  const moved = container.querySelector("[data-moved]");
  expect(moved).not.toBeNull();
  // The foreign mutation: an extension content script (or the browser's page
  // translator) adopts the node into DOM of its own.
  document.createElement("section").appendChild(moved!);

  // `act` rethrows whatever React escalates, so both delivery paths (the root
  // callback and the rethrow) have to be collected for the comparison to mean
  // anything.
  const run = (work: () => void): void => {
    try {
      act(work);
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  };
  run(() => root.render(<Tree mounted={false} />));
  run(() => root.unmount());
  container.remove();
  return errors;
}

describe("foreign DOM mutation guard", () => {
  it("keeps a foreign reparent from escalating to a root teardown", () => {
    const unguarded = unmountAfterForeignReparent();
    expect(unguarded).toHaveLength(1);
    // jsdom drops Chrome's "Failed to execute 'removeChild' on 'Node'" prefix;
    // the shared part of the DOMException message is the stable assertion.
    expect(unguarded[0]?.message).toMatch(/not a child of this node/);

    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    installForeignDomMutationGuard();
    expect(unmountAfterForeignReparent()).toEqual([]);
    expect(foreignDomMutationCount()).toBe(1);
  });


  it("suppresses the removeChild that a foreign reparent turns into a throw", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const reactParent = document.createElement("div");
    const child = document.createElement("span");
    reactParent.appendChild(child);
    installForeignDomMutationGuard();

    // What an extension (or the browser's translator) does: adopt the node
    // into DOM of its own, leaving React still pointing at `reactParent`.
    const foreignParent = document.createElement("font");
    foreignParent.appendChild(child);

    expect(() => reactParent.removeChild(child)).not.toThrow();
    expect(foreignDomMutationCount()).toBe(1);
    expect(warn).toHaveBeenCalledOnce();
    // The node is left where the foreign mutation put it rather than detached,
    // so a later unmount of `foreignParent` still cleans it up.
    expect(child.parentNode).toBe(foreignParent);
  });

  it("appends instead of throwing when the insertBefore reference node moved away", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const parent = document.createElement("div");
    const reference = document.createElement("span");
    parent.appendChild(reference);
    installForeignDomMutationGuard();
    document.createElement("font").appendChild(reference);

    const inserted = document.createElement("b");
    expect(() => parent.insertBefore(inserted, reference)).not.toThrow();
    // Dropping the node would silently lose rendered content; appending keeps
    // it reachable, with only its ordering disturbed.
    expect(inserted.parentNode).toBe(parent);
    expect(foreignDomMutationCount()).toBe(1);
  });

  it("leaves well-formed calls on the native path", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    installForeignDomMutationGuard();
    const parent = document.createElement("div");
    const first = document.createElement("span");
    const second = document.createElement("span");
    parent.appendChild(second);

    expect(parent.insertBefore(first, second)).toBe(first);
    expect([...parent.children]).toEqual([first, second]);
    expect(parent.removeChild(first)).toBe(first);
    expect([...parent.children]).toEqual([second]);
    expect(foreignDomMutationCount()).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });
});
