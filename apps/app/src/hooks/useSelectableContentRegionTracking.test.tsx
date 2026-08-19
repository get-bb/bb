// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useSelectableContentRegionTracking } from "./useSelectableContentRegionTracking";

function SelectionTracker() {
  useSelectableContentRegionTracking();
  return null;
}

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
}

function createFixture(): SelectionFixture {
  const shell = document.createElement("div");
  shell.innerHTML = `
    <aside data-testid="sidebar">Sidebar chrome</aside>
    <main>
      <section data-testid="main-region" data-selectable-content-region>
        <p data-testid="main-message">Main timeline message</p>
        <a data-testid="main-link" href="#details">Message details</a>
        <button data-testid="main-action">Message action</button>
      </section>
      <div data-testid="composer" contenteditable="true">Composer draft</div>
    </main>
    <section data-testid="side-region" data-selectable-content-region>
      <p data-testid="side-message">Side chat message</p>
    </section>
    <button class="select-text" data-testid="diagnostic">
      Workspace: /tmp/selection-qa
    </button>
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
  cleanup();
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
});

describe("useSelectableContentRegionTracking", () => {
  it("switches the active selection boundary with pointer interaction", () => {
    render(<SelectionTracker />);
    const fixture = createFixture();

    fireEvent.pointerDown(fixture.mainMessage);
    expect(fixture.mainRegion.hasAttribute("data-selection-active")).toBe(true);
    expect(document.activeElement).toBe(fixture.mainRegion);

    fireEvent.pointerDown(fixture.sideMessage);
    expect(fixture.mainRegion.hasAttribute("data-selection-active")).toBe(
      false,
    );
    expect(fixture.sideRegion.hasAttribute("data-selection-active")).toBe(true);
    expect(document.activeElement).toBe(fixture.sideRegion);
  });

  it("scopes Select All to the active content boundary", () => {
    render(<SelectionTracker />);
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
    render(<SelectionTracker />);
    const fixture = createFixture();

    fixture.mainLink.focus();
    const event = dispatchSelectAll(fixture.mainLink);

    expect(document.activeElement).toBe(fixture.mainLink);
    expect(fixture.mainRegion.hasAttribute("data-selection-active")).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(window.getSelection()?.toString()).toContain(
      "Main timeline message",
    );
  });

  it("leaves app chrome, editors, and nested controls to their native behavior", () => {
    render(<SelectionTracker />);
    const fixture = createFixture();

    for (const target of [
      fixture.sidebar,
      fixture.composer,
      fixture.mainAction,
    ]) {
      fireEvent.pointerDown(fixture.mainMessage);
      expect(fixture.mainRegion.hasAttribute("data-selection-active")).toBe(
        true,
      );

      fireEvent.pointerDown(target);
      expect(dispatchSelectAll(target).defaultPrevented).toBe(false);
      expect(fixture.mainRegion.hasAttribute("data-selection-active")).toBe(
        false,
      );
    }
  });

  it("allows an explicitly selectable control to scope Select All", () => {
    render(<SelectionTracker />);
    const fixture = createFixture();

    fireEvent.pointerDown(fixture.diagnostic);
    const event = dispatchSelectAll(fixture.diagnostic);

    expect(event.defaultPrevented).toBe(true);
    expect(window.getSelection()?.toString().trim()).toBe(
      "Workspace: /tmp/selection-qa",
    );
  });

  it("removes managed focus state and event behavior when unmounted", () => {
    const { unmount } = render(<SelectionTracker />);
    const fixture = createFixture();

    fireEvent.pointerDown(fixture.mainMessage);
    expect(fixture.mainRegion.getAttribute("tabindex")).toBe("-1");

    unmount();
    expect(fixture.mainRegion.hasAttribute("data-selection-active")).toBe(
      false,
    );
    expect(fixture.mainRegion.hasAttribute("tabindex")).toBe(false);
    expect(dispatchSelectAll(fixture.mainRegion).defaultPrevented).toBe(false);
  });
});
