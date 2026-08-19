// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppSelectAllController } from "@/components/AppSelectAllController";

interface SelectionFixture {
  composer: HTMLDivElement;
  diagnostic: HTMLButtonElement;
  mainAction: HTMLButtonElement;
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

  it("suppresses Select All in app chrome but leaves editors and controls native", () => {
    render(<AppSelectAllController />);
    const fixture = createFixture();

    for (const target of [fixture.composer, fixture.mainAction]) {
      fireEvent.pointerDown(target);
      expect(dispatchSelectAll(target).defaultPrevented).toBe(false);
    }

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

  it("does not infer a Select All scope from drag-selectable text", () => {
    render(<AppSelectAllController />);
    const fixture = createFixture();

    fireEvent.pointerDown(fixture.standaloneText);
    const event = dispatchSelectAll(fixture.standaloneText);

    expect(event.defaultPrevented).toBe(true);
    expect(window.getSelection()?.isCollapsed).toBe(true);
  });

  it("selects through an open shadow root at the browser boundary", () => {
    render(<AppSelectAllController />);
    const fixture = createFixture();
    const shadowHost = document.createElement("div");
    shadowHost.attachShadow({ mode: "open" }).innerHTML =
      "<code>shadow-root file contents</code>";
    fixture.mainRegion.append(shadowHost);
    const shadowText =
      shadowHost.shadowRoot!.querySelector("code")!.firstChild!;
    const setBaseAndExtent = vi.spyOn(
      window.getSelection()!,
      "setBaseAndExtent",
    );

    fireEvent.pointerDown(shadowHost);
    const event = dispatchSelectAll(fixture.mainRegion);

    expect(event.defaultPrevented).toBe(true);
    expect(setBaseAndExtent).toHaveBeenCalledWith(
      expect.any(Text),
      0,
      shadowText,
      "shadow-root file contents".length,
    );
  });

  it("removes app-level event behavior when unmounted", () => {
    const { unmount } = render(<AppSelectAllController />);
    const fixture = createFixture();

    fireEvent.pointerDown(fixture.mainMessage);

    unmount();
    expect(dispatchSelectAll(fixture.mainRegion).defaultPrevented).toBe(false);
  });
});
