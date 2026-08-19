// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppSelectAllController } from "@/components/AppSelectAllController";

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

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
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

  it("keeps control labels unselectable inside an active open shadow root", () => {
    render(<AppSelectAllController />);
    const fixture = createFixture();
    const shadowHost = document.createElement("div");
    const shadowRoot = shadowHost.attachShadow({ mode: "open" });
    const button = document.createElement("button");
    button.textContent = "Shadow action";
    shadowRoot.append(button);
    fixture.mainRegion.append(shadowHost);

    button.dispatchEvent(
      new Event("pointerdown", { bubbles: true, composed: true }),
    );

    expect(
      shadowRoot.querySelector<HTMLStyleElement>(
        "style[data-bb-app-selection-policy]",
      )?.textContent,
    ).toContain("user-select: none !important");
  });

  it("removes app-level event behavior when unmounted", () => {
    const { unmount } = render(<AppSelectAllController />);
    const fixture = createFixture();

    fireEvent.pointerDown(fixture.mainMessage);

    unmount();
    expect(dispatchSelectAll(fixture.mainRegion).defaultPrevented).toBe(false);
  });
});
