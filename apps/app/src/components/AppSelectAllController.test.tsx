// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { BbDesktopApi } from "@bb/desktop-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppSelectAllController } from "@/components/AppSelectAllController";
import { registerSelectAllCopyText } from "@/lib/select-all-scope";

interface SelectionFixture {
  composer: HTMLDivElement;
  diagnostic: HTMLButtonElement;
  mainAction: HTMLButtonElement;
  mainCheckbox: HTMLInputElement;
  mainLink: HTMLAnchorElement;
  mainMessage: HTMLParagraphElement;
  mainRegion: HTMLElement;
  sidebar: HTMLElement;
  sideMessage: HTMLParagraphElement;
  sideRegion: HTMLElement;
  standaloneText: HTMLParagraphElement;
}

function createFixture(): SelectionFixture {
  const shell = document.createElement("div");
  shell.innerHTML = `
    <aside data-testid="sidebar">Sidebar chrome</aside>
    <main>
      <section data-testid="main-region" data-select-all-scope>
        <p data-testid="main-message">Main timeline message</p>
        <a data-testid="main-link" href="#details">Message details</a>
        <button data-testid="main-action">Message action</button>
        <input data-testid="main-checkbox" type="checkbox" />
      </section>
      <div data-testid="composer" contenteditable="true">Composer draft</div>
    </main>
    <section data-testid="side-region" data-select-all-scope>
      <p data-testid="side-message">Side chat message</p>
    </section>
    <button class="select-text" data-select-all-scope data-testid="diagnostic">
      Workspace: /tmp/selection-qa
    </button>
    <p class="select-text" data-testid="standalone-text">Standalone text</p>
  `;
  document.body.append(shell);

  function requireElement<T extends Element>(testId: string): T {
    const element = shell.querySelector<T>(`[data-testid="${testId}"]`);
    if (element === null) throw new Error(`Missing fixture element: ${testId}`);
    return element;
  }

  return {
    composer: requireElement("composer"),
    diagnostic: requireElement("diagnostic"),
    mainAction: requireElement("main-action"),
    mainCheckbox: requireElement("main-checkbox"),
    mainLink: requireElement("main-link"),
    mainMessage: requireElement("main-message"),
    mainRegion: requireElement("main-region"),
    sidebar: requireElement("sidebar"),
    sideMessage: requireElement("side-message"),
    sideRegion: requireElement("side-region"),
    standaloneText: requireElement("standalone-text"),
  };
}

function dispatchSelectAll(target: Element): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "a",
    metaKey: true,
  });
  target.dispatchEvent(event);
  return event;
}

function installDesktopSelectAllBridge(): () => boolean {
  let listener: (() => boolean) | undefined;
  window.bbDesktop = {
    onSelectAll(nextListener: () => boolean) {
      listener = nextListener;
      return () => undefined;
    },
  } as unknown as BbDesktopApi;
  return () => listener?.() ?? false;
}

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
  delete window.bbDesktop;
});

describe("AppSelectAllController", () => {
  it("tracks pointer interaction without changing selectable-content styles", () => {
    render(<AppSelectAllController />);
    const fixture = createFixture();
    const regionMarkup = fixture.mainRegion.outerHTML;

    fireEvent.pointerDown(fixture.mainMessage);
    expect(fixture.mainRegion.outerHTML).toBe(regionMarkup);
  });

  it("scopes Select All to the active content boundary", () => {
    render(<AppSelectAllController />);
    const fixture = createFixture();

    fireEvent.pointerDown(fixture.mainMessage);
    const event = dispatchSelectAll(fixture.mainRegion);

    expect(event.defaultPrevented).toBe(true);
    expect(window.getSelection()?.toString()).toContain(
      "Main timeline message",
    );
    expect(window.getSelection()?.toString()).not.toContain(
      "Side chat message",
    );
    expect(window.getSelection()?.toString()).not.toContain("Composer draft");
  });

  it("handles Select All before a descendant stops keydown propagation", () => {
    render(<AppSelectAllController />);
    const fixture = createFixture();
    fixture.mainAction.addEventListener("keydown", (event) => {
      event.stopPropagation();
    });

    fireEvent.pointerDown(fixture.mainAction);
    const event = dispatchSelectAll(fixture.mainAction);

    expect(event.defaultPrevented).toBe(true);
    expect(window.getSelection()?.toString()).toContain(
      "Main timeline message",
    );
    expect(window.getSelection()?.toString()).not.toContain(
      "Side chat message",
    );
  });

  it("scopes Select All requested by the native desktop menu", () => {
    const requestSelectAll = installDesktopSelectAllBridge();
    render(<AppSelectAllController />);
    const fixture = createFixture();

    fireEvent.pointerDown(fixture.mainMessage);
    act(requestSelectAll);

    expect(window.getSelection()?.toString()).toContain(
      "Main timeline message",
    );
    expect(window.getSelection()?.toString()).not.toContain(
      "Side chat message",
    );
  });

  it("leaves desktop Select All to Electron when an iframe owns focus", () => {
    const requestSelectAll = installDesktopSelectAllBridge();
    render(<AppSelectAllController />);
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    iframe.focus();

    expect(document.activeElement).toBe(iframe);
    expect(requestSelectAll()).toBe(false);
  });

  it("keeps native desktop Select All inside a shadow-root editor", () => {
    const requestSelectAll = installDesktopSelectAllBridge();
    render(<AppSelectAllController />);
    const fixture = createFixture();
    const shadowHost = document.createElement("div");
    const shadowRoot = shadowHost.attachShadow({ mode: "open" });
    const input = document.createElement("input");
    input.value = "shadow editor value";
    shadowRoot.append(input);
    fixture.mainRegion.append(shadowHost);
    input.focus();
    input.setSelectionRange(4, 4);

    act(requestSelectAll);

    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it("prefers the focused editor over a stale reading scope for desktop Select All", () => {
    const requestSelectAll = installDesktopSelectAllBridge();
    render(<AppSelectAllController />);
    const fixture = createFixture();
    const editor = document.createElement("textarea");
    editor.value = "focused draft";
    document.body.append(editor);
    editor.focus();
    editor.setSelectionRange(4, 4);

    fireEvent.pointerDown(fixture.mainMessage);
    act(requestSelectAll);

    expect(editor.selectionStart).toBe(0);
    expect(editor.selectionEnd).toBe(editor.value.length);
    expect(window.getSelection()?.toString()).not.toContain(
      "Main timeline message",
    );
  });

  it("activates a content boundary when keyboard focus enters it", () => {
    render(<AppSelectAllController />);
    const fixture = createFixture();

    fixture.mainLink.focus();
    const event = dispatchSelectAll(fixture.mainLink);

    expect(document.activeElement).toBe(fixture.mainLink);
    expect(event.defaultPrevented).toBe(true);
    expect(window.getSelection()?.toString()).toContain(
      "Main timeline message",
    );
  });

  it("keeps editors native while controls retain their reading scope", () => {
    render(<AppSelectAllController />);
    const fixture = createFixture();

    fireEvent.pointerDown(fixture.composer);
    expect(dispatchSelectAll(fixture.composer).defaultPrevented).toBe(false);

    fireEvent.pointerDown(fixture.mainAction);
    const controlEvent = dispatchSelectAll(fixture.mainAction);
    expect(controlEvent.defaultPrevented).toBe(true);
    expect(window.getSelection()?.toString()).toContain(
      "Main timeline message",
    );
    expect(window.getSelection()?.toString()).not.toContain(
      "Side chat message",
    );

    fireEvent.pointerDown(fixture.sidebar);
    expect(dispatchSelectAll(fixture.sidebar).defaultPrevented).toBe(true);
  });

  it("allows an explicitly selectable control to scope Select All", () => {
    render(<AppSelectAllController />);
    const fixture = createFixture();

    fireEvent.pointerDown(fixture.diagnostic);
    const event = dispatchSelectAll(fixture.diagnostic);

    expect(event.defaultPrevented).toBe(true);
    expect(window.getSelection()?.toString().trim()).toBe(
      "Workspace: /tmp/selection-qa",
    );
  });

  it("keeps non-editing inputs in their reading scope", () => {
    render(<AppSelectAllController />);
    const fixture = createFixture();

    fireEvent.pointerDown(fixture.mainCheckbox);
    const event = dispatchSelectAll(fixture.mainCheckbox);

    expect(event.defaultPrevented).toBe(true);
    expect(window.getSelection()?.toString()).toContain(
      "Main timeline message",
    );
    expect(window.getSelection()?.toString()).not.toContain(
      "Side chat message",
    );
  });

  it("leaves Select All native in a multi-select control", () => {
    render(<AppSelectAllController />);
    const fixture = createFixture();
    const select = document.createElement("select");
    select.multiple = true;
    select.append(new Option("One"), new Option("Two"));
    fixture.mainRegion.append(select);

    fireEvent.pointerDown(select);

    expect(dispatchSelectAll(select).defaultPrevented).toBe(false);
  });

  it("leaves Select All native in an editor inside an open shadow root", () => {
    render(<AppSelectAllController />);
    const fixture = createFixture();
    const shadowHost = document.createElement("div");
    const shadowRoot = shadowHost.attachShadow({ mode: "open" });
    const input = document.createElement("input");
    input.value = "shadow editor value";
    shadowRoot.append(input);
    fixture.mainRegion.append(shadowHost);

    input.dispatchEvent(
      new Event("pointerdown", { bubbles: true, composed: true }),
    );
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      composed: true,
      key: "a",
      metaKey: true,
    });
    input.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it("retains an outer reading scope when interaction starts in its shadow tree", () => {
    render(<AppSelectAllController />);
    const fixture = createFixture();
    const shadowHost = document.createElement("div");
    const shadowRoot = shadowHost.attachShadow({ mode: "open" });
    const shadowText = document.createElement("span");
    shadowText.textContent = "shadow reading text";
    shadowRoot.append(shadowText);
    fixture.mainRegion.insertBefore(shadowHost, fixture.mainAction);
    const shadowTextNode = shadowText.firstChild!;
    const setBaseAndExtent = vi.spyOn(
      window.getSelection()!,
      "setBaseAndExtent",
    );

    shadowText.dispatchEvent(
      new Event("pointerdown", { bubbles: true, composed: true }),
    );
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      composed: true,
      key: "a",
      metaKey: true,
    });
    shadowText.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(setBaseAndExtent).toHaveBeenCalledWith(
      shadowTextNode,
      0,
      shadowTextNode,
      "shadow reading text".length,
    );
  });

  it("does not infer a Select All scope from drag-selectable text", () => {
    render(<AppSelectAllController />);
    const fixture = createFixture();

    fireEvent.pointerDown(fixture.standaloneText);
    const event = dispatchSelectAll(fixture.standaloneText);

    expect(event.defaultPrevented).toBe(true);
    expect(window.getSelection()?.isCollapsed).toBe(true);
  });

  it("clears a scoped copy override when Select All moves to app chrome", () => {
    render(<AppSelectAllController />);
    const fixture = createFixture();
    const unregister = registerSelectAllCopyText(
      fixture.mainRegion,
      () => "AUTHORITATIVE_VIRTUALIZED_TEXT",
    );

    fireEvent.pointerDown(fixture.mainMessage);
    dispatchSelectAll(fixture.mainMessage);
    fireEvent.pointerDown(fixture.sidebar);
    dispatchSelectAll(fixture.sidebar);

    const setData = vi.fn();
    const copyEvent = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(copyEvent, "clipboardData", {
      value: { setData },
    });
    document.dispatchEvent(copyEvent);

    expect(setData).not.toHaveBeenCalled();
    expect(copyEvent.defaultPrevented).toBe(false);
    unregister();
  });

  it("retains a scoped copy override across an unrelated legacy copy", () => {
    render(<AppSelectAllController />);
    const fixture = createFixture();
    const unregister = registerSelectAllCopyText(
      fixture.mainRegion,
      () => "AUTHORITATIVE_VIRTUALIZED_TEXT",
    );

    fireEvent.pointerDown(fixture.mainMessage);
    dispatchSelectAll(fixture.mainMessage);
    const selection = window.getSelection()!;
    const scopedSelection = {
      anchorNode: selection.anchorNode!,
      anchorOffset: selection.anchorOffset,
      focusNode: selection.focusNode!,
      focusOffset: selection.focusOffset,
    };

    selection.setBaseAndExtent(
      fixture.standaloneText.firstChild!,
      0,
      fixture.standaloneText.firstChild!,
      fixture.standaloneText.textContent!.length,
    );
    const unrelatedCopy = new Event("copy", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(unrelatedCopy, "clipboardData", {
      value: { setData: vi.fn() },
    });
    document.dispatchEvent(unrelatedCopy);
    expect(unrelatedCopy.defaultPrevented).toBe(false);

    selection.setBaseAndExtent(
      scopedSelection.anchorNode,
      scopedSelection.anchorOffset,
      scopedSelection.focusNode,
      scopedSelection.focusOffset,
    );
    const setData = vi.fn();
    const scopedCopy = new Event("copy", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(scopedCopy, "clipboardData", {
      value: { setData },
    });
    document.dispatchEvent(scopedCopy);

    expect(setData).toHaveBeenCalledWith(
      "text/plain",
      "AUTHORITATIVE_VIRTUALIZED_TEXT",
    );
    expect(scopedCopy.defaultPrevented).toBe(true);
    unregister();
  });

  it("suppresses native app-wide Select All when an event has no element target", () => {
    render(<AppSelectAllController />);
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "a",
      metaKey: true,
    });

    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("recognizes the physical Select All key on a non-Latin layout", () => {
    render(<AppSelectAllController />);
    const fixture = createFixture();
    fireEvent.pointerDown(fixture.mainMessage);
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "KeyA",
      key: "ф",
      metaKey: true,
    });

    fixture.mainMessage.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(window.getSelection()?.toString()).toContain(
      "Main timeline message",
    );
  });

  it("selects the active shadow-root content without crossing tree boundaries", () => {
    render(<AppSelectAllController />);
    const fixture = createFixture();
    const shadowHost = document.createElement("div");
    shadowHost.attachShadow({ mode: "open" }).innerHTML =
      "<code>shadow-root file contents</code>";
    fixture.mainRegion.append(shadowHost);
    const shadowCode = shadowHost.shadowRoot!.querySelector("code")!;
    const shadowText = shadowCode.firstChild!;
    const setBaseAndExtent = vi.spyOn(
      window.getSelection()!,
      "setBaseAndExtent",
    );

    shadowCode.dispatchEvent(
      new Event("pointerdown", { bubbles: true, composed: true }),
    );
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      composed: true,
      key: "a",
      metaKey: true,
    });
    shadowCode.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(setBaseAndExtent).toHaveBeenCalledWith(
      shadowText,
      0,
      shadowText,
      "shadow-root file contents".length,
    );
  });

  it("keeps shadow-root Select All visible and copyable when native selection collapses", () => {
    render(<AppSelectAllController />);
    const fixture = createFixture();
    const scope = document.createElement("section");
    scope.dataset.selectAllScope = "";
    const shadowHost = document.createElement("div");
    shadowHost.attachShadow({ mode: "open" }).innerHTML =
      "<code>shadow-root file contents</code><button>Shadow action</button><code>shadow tail</code>";
    scope.append(shadowHost);
    fixture.mainRegion.append(scope);
    const shadowCode = shadowHost.shadowRoot!.querySelector("code")!;
    const selection = window.getSelection()!;
    vi.spyOn(selection, "setBaseAndExtent").mockImplementation(() => {
      selection.removeAllRanges();
    });
    const highlightSet = vi.fn();
    const highlightDelete = vi.fn();
    const originalCss = globalThis.CSS;
    const originalHighlight = globalThis.Highlight;
    Object.defineProperty(globalThis, "CSS", {
      configurable: true,
      value: {
        highlights: { delete: highlightDelete, set: highlightSet },
      },
    });
    const createdHighlights: Range[][] = [];
    Object.defineProperty(globalThis, "Highlight", {
      configurable: true,
      value: class TestHighlight {
        constructor(...ranges: Range[]) {
          createdHighlights.push(ranges);
        }
      },
    });
    const unregister = registerSelectAllCopyText(
      scope,
      () => "AUTHORITATIVE_SHADOW_TEXT",
    );

    fireEvent.pointerDown(shadowCode);
    shadowCode.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        composed: true,
        key: "a",
        metaKey: true,
      }),
    );

    expect(highlightSet).toHaveBeenCalledTimes(1);
    expect(createdHighlights[0]?.map((range) => range.toString())).toEqual([
      "shadow-root file contents",
      "shadow tail",
    ]);
    const setData = vi.fn();
    const copyEvent = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(copyEvent, "clipboardData", {
      value: { setData },
    });
    document.dispatchEvent(copyEvent);
    expect(setData).toHaveBeenCalledWith(
      "text/plain",
      "AUTHORITATIVE_SHADOW_TEXT",
    );
    expect(copyEvent.defaultPrevented).toBe(true);

    unregister();
    fireEvent.pointerDown(shadowCode);
    shadowCode.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        composed: true,
        key: "a",
        metaKey: true,
      }),
    );
    const fallbackSetData = vi.fn();
    const fallbackCopyEvent = new Event("copy", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(fallbackCopyEvent, "clipboardData", {
      value: { setData: fallbackSetData },
    });
    document.dispatchEvent(fallbackCopyEvent);
    expect(fallbackSetData).toHaveBeenCalledWith(
      "text/plain",
      "shadow-root file contentsshadow tail",
    );

    fireEvent.pointerDown(fixture.sidebar);
    expect(highlightDelete).toHaveBeenCalled();
    Object.defineProperty(globalThis, "CSS", {
      configurable: true,
      value: originalCss,
    });
    Object.defineProperty(globalThis, "Highlight", {
      configurable: true,
      value: originalHighlight,
    });
  });

  it("selects a shadow-only scope when interaction starts on its light-DOM padding", () => {
    render(<AppSelectAllController />);
    const scope = document.createElement("section");
    scope.dataset.selectAllScope = "";
    const shadowHost = document.createElement("div");
    const shadowRoot = shadowHost.attachShadow({ mode: "open" });
    const shadowCode = document.createElement("code");
    shadowCode.textContent = "shadow-only file contents";
    shadowRoot.append(shadowCode);
    scope.append("\n  ", shadowHost, "\n");
    document.body.append(scope);
    const shadowText = shadowCode.firstChild!;
    const setBaseAndExtent = vi.spyOn(
      window.getSelection()!,
      "setBaseAndExtent",
    );

    fireEvent.pointerDown(scope);
    const event = dispatchSelectAll(scope);

    expect(event.defaultPrevented).toBe(true);
    expect(setBaseAndExtent).toHaveBeenCalledWith(
      shadowText,
      0,
      shadowText,
      "shadow-only file contents".length,
    );
  });

  it("resolves the selection root when Select All is requested", () => {
    render(<AppSelectAllController />);
    const scope = document.createElement("section");
    scope.dataset.selectAllScope = "";
    const shadowHost = document.createElement("div");
    shadowHost.attachShadow({ mode: "open" }).innerHTML =
      "<code>shadow-only file contents</code>";
    scope.append(shadowHost);
    document.body.append(scope);

    fireEvent.pointerDown(scope);
    const lateText = document.createElement("p");
    lateText.textContent = "content rendered before Select All";
    scope.append(lateText);
    const lateTextNode = lateText.firstChild!;
    const setBaseAndExtent = vi.spyOn(
      window.getSelection()!,
      "setBaseAndExtent",
    );

    dispatchSelectAll(scope);

    expect(setBaseAndExtent).toHaveBeenCalledWith(
      lateTextNode,
      0,
      lateTextNode,
      "content rendered before Select All".length,
    );
  });

  it("does not select a different segment after the interaction anchor is removed", () => {
    render(<AppSelectAllController />);
    const fixture = createFixture();
    const setBaseAndExtent = vi.spyOn(
      window.getSelection()!,
      "setBaseAndExtent",
    );

    fireEvent.pointerDown(fixture.mainLink);
    fixture.mainLink.remove();
    dispatchSelectAll(fixture.mainRegion);

    expect(setBaseAndExtent).not.toHaveBeenCalled();
  });

  it("excludes an inline editor between reading-content endpoints", () => {
    render(<AppSelectAllController />);
    const fixture = createFixture();
    const inlineEditor = document.createElement("div");
    inlineEditor.setAttribute("contenteditable", "true");
    inlineEditor.textContent = "UNSENT INLINE DRAFT";
    fixture.mainRegion.insertBefore(inlineEditor, fixture.mainLink);

    fireEvent.pointerDown(fixture.mainMessage);
    dispatchSelectAll(fixture.mainMessage);

    expect(window.getSelection()?.toString()).toContain(
      "Main timeline message",
    );
    expect(window.getSelection()?.toString()).not.toContain(
      "UNSENT INLINE DRAFT",
    );
    expect(window.getSelection()?.toString()).not.toContain("Message details");

    fireEvent.pointerDown(fixture.mainLink);
    dispatchSelectAll(fixture.mainLink);

    expect(window.getSelection()?.toString()).toContain("Message details");
    expect(window.getSelection()?.toString()).not.toContain(
      "Main timeline message",
    );
    expect(window.getSelection()?.toString()).not.toContain(
      "UNSENT INLINE DRAFT",
    );
  });

  it("excludes CSS-hidden text from scoped Select All endpoints", () => {
    render(<AppSelectAllController />);
    const scope = document.createElement("section");
    scope.dataset.selectAllScope = "";
    const visible = document.createElement("p");
    visible.textContent = "VISIBLE CONTENT";
    const hidden = document.createElement("p");
    hidden.textContent = "HIDDEN CONTENT";
    hidden.style.display = "none";
    Object.defineProperty(hidden, "checkVisibility", {
      configurable: true,
      value: () => false,
    });
    scope.append(visible, hidden);
    document.body.append(scope);

    fireEvent.pointerDown(visible);
    dispatchSelectAll(visible);

    expect(window.getSelection()?.toString()).toBe("VISIBLE CONTENT");
  });

  it("does not mutate an active open shadow root", () => {
    render(<AppSelectAllController />);
    const fixture = createFixture();
    const shadowHost = document.createElement("div");
    const shadowRoot = shadowHost.attachShadow({ mode: "open" });
    const button = document.createElement("button");
    button.textContent = "Shadow action";
    shadowRoot.append(button);
    fixture.mainRegion.append(shadowHost);
    const shadowMarkup = shadowRoot.innerHTML;

    button.dispatchEvent(
      new Event("pointerdown", { bubbles: true, composed: true }),
    );

    expect(shadowRoot.innerHTML).toBe(shadowMarkup);
  });

  it("removes app-level event behavior when unmounted", () => {
    const { unmount } = render(<AppSelectAllController />);
    const fixture = createFixture();

    fireEvent.pointerDown(fixture.mainMessage);

    unmount();
    expect(dispatchSelectAll(fixture.mainRegion).defaultPrevented).toBe(false);
  });
});
