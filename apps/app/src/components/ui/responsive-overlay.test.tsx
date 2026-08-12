// @vitest-environment jsdom

import type {
  AnimationEvent as ReactAnimationEvent,
  HTMLAttributes,
  ReactNode,
} from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POINTER_COARSE_QUERY } from "@bb/shared-ui/hooks/use-pointer-coarse";
import {
  PersistentResponsiveDrawerShell,
  ResponsiveDrawerShell,
} from "@bb/shared-ui/responsive-overlay";

type CapturedAnimationEnd = (args: {
  currentTarget: HTMLElement;
  target: EventTarget;
}) => void;
type CapturedPointerDownOutside = (
  event: CustomEvent<{ originalEvent: Event }>,
) => void;

const drawerContentState = vi.hoisted(() => ({
  fireAnimationEnd: undefined as CapturedAnimationEnd | undefined,
  fireOpenAutoFocus: undefined as ((event: Event) => void) | undefined,
  firePointerDownOutside: undefined as CapturedPointerDownOutside | undefined,
}));

// ResponsiveDrawerShell now lives in @bb/shared-ui and imports its own
// `./drawer.js`; mock that module (the same resolved file) so the shared-ui
// import graph — not the app re-export shim — picks up the stub.
vi.mock("@bb/shared-ui/drawer", async () => {
  const React = await import("react");

  const Drawer = ({ children }: { children: ReactNode }) =>
    React.createElement("div", { "data-testid": "drawer" }, children);

  interface MockDrawerContentProps extends HTMLAttributes<HTMLDivElement> {
    onOpenAutoFocus?: (event: Event) => void;
    onPointerDownOutside?: CapturedPointerDownOutside;
  }

  const DrawerContent = React.forwardRef<
    HTMLDivElement,
    MockDrawerContentProps
  >(
    (
      {
        children,
        onAnimationEnd,
        onOpenAutoFocus,
        onPointerDownOutside,
        ...props
      },
      ref,
    ) => {
      drawerContentState.fireAnimationEnd = ({ currentTarget, target }) => {
        onAnimationEnd?.({
          currentTarget,
          target,
        } as ReactAnimationEvent<HTMLDivElement>);
      };
      drawerContentState.fireOpenAutoFocus = onOpenAutoFocus;
      drawerContentState.firePointerDownOutside = onPointerDownOutside;

      return React.createElement(
        "div",
        { ...props, ref, "data-testid": "drawer-content" },
        children,
      );
    },
  );
  DrawerContent.displayName = "MockDrawerContent";

  const DrawerTitle = ({
    children,
    ...props
  }: HTMLAttributes<HTMLHeadingElement>) =>
    React.createElement("h2", props, children);

  return { Drawer, DrawerContent, DrawerTitle };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  drawerContentState.fireAnimationEnd = undefined;
  drawerContentState.fireOpenAutoFocus = undefined;
  drawerContentState.firePointerDownOutside = undefined;
});

function fireDrawerContentAnimationEnd(target: EventTarget) {
  const fireAnimationEnd = drawerContentState.fireAnimationEnd;
  if (fireAnimationEnd === undefined) {
    throw new Error("DrawerContent did not receive an animation handler");
  }
  fireAnimationEnd({
    currentTarget: screen.getByTestId("drawer-content"),
    target,
  });
}

function mockPointerCoarse(matches: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches: query === POINTER_COARSE_QUERY && matches,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

function fireDrawerOpenAutoFocus(): Event {
  const fireOpenAutoFocus = drawerContentState.fireOpenAutoFocus;
  if (fireOpenAutoFocus === undefined) {
    throw new Error("DrawerContent did not receive an autofocus handler");
  }
  const event = new Event("openAutoFocus", { cancelable: true });
  fireOpenAutoFocus(event);
  return event;
}

function fireDrawerPointerDownOutside(
  originalTarget: HTMLElement,
): CustomEvent<{ originalEvent: Event }> {
  const firePointerDownOutside = drawerContentState.firePointerDownOutside;
  if (firePointerDownOutside === undefined) {
    throw new Error(
      "DrawerContent did not receive a pointer down outside handler",
    );
  }
  const originalEvent = new Event("pointerdown", {
    bubbles: true,
    cancelable: true,
  });
  originalTarget.dispatchEvent(originalEvent);
  const event = new CustomEvent("pointerDownOutside", {
    cancelable: true,
    detail: { originalEvent },
  });
  firePointerDownOutside(event);
  return event;
}

describe("ResponsiveDrawerShell", () => {
  it("forwards own content animation completion and ignores bubbled child animation events", () => {
    const onContentAnimationEnd = vi.fn();

    render(
      <ResponsiveDrawerShell
        open={true}
        onOpenChange={() => {}}
        onContentAnimationEnd={onContentAnimationEnd}
      >
        <div data-testid="animated-child" />
      </ResponsiveDrawerShell>,
    );

    fireDrawerContentAnimationEnd(screen.getByTestId("animated-child"));
    expect(onContentAnimationEnd).not.toHaveBeenCalled();

    fireDrawerContentAnimationEnd(screen.getByTestId("drawer-content"));
    expect(onContentAnimationEnd).toHaveBeenCalledTimes(1);
    expect(onContentAnimationEnd).toHaveBeenCalledWith(true);
  });

  it("reports closed content animation completion with the current closed state", () => {
    const onContentAnimationEnd = vi.fn();

    render(
      <ResponsiveDrawerShell
        open={false}
        onOpenChange={() => {}}
        onContentAnimationEnd={onContentAnimationEnd}
      >
        <div />
      </ResponsiveDrawerShell>,
    );

    fireDrawerContentAnimationEnd(screen.getByTestId("drawer-content"));
    expect(onContentAnimationEnd).toHaveBeenCalledTimes(1);
    expect(onContentAnimationEnd).toHaveBeenCalledWith(false);
  });

  it("prevents drawer open autofocus on coarse pointers", () => {
    mockPointerCoarse(true);

    render(
      <ResponsiveDrawerShell open={true} onOpenChange={() => {}}>
        <input aria-label="Search" />
      </ResponsiveDrawerShell>,
    );

    expect(fireDrawerOpenAutoFocus().defaultPrevented).toBe(true);
  });

  it("allows drawer open autofocus on fine pointers", () => {
    mockPointerCoarse(false);

    render(
      <ResponsiveDrawerShell open={true} onOpenChange={() => {}}>
        <input aria-label="Search" />
      </ResponsiveDrawerShell>,
    );

    expect(fireDrawerOpenAutoFocus().defaultPrevented).toBe(false);
  });

  it("prevents drawer outside dismissal for Sonner toast interactions", () => {
    render(
      <ResponsiveDrawerShell open={true} onOpenChange={() => {}}>
        <div />
      </ResponsiveDrawerShell>,
    );

    const toaster = document.createElement("ol");
    toaster.setAttribute("data-sonner-toaster", "");
    const toastAction = document.createElement("button");
    toaster.appendChild(toastAction);
    document.body.appendChild(toaster);

    try {
      expect(fireDrawerPointerDownOutside(toastAction).defaultPrevented).toBe(
        true,
      );
    } finally {
      toaster.remove();
    }
  });

  it("allows ordinary outside pointer interactions to dismiss the drawer", () => {
    render(
      <ResponsiveDrawerShell open={true} onOpenChange={() => {}}>
        <div />
      </ResponsiveDrawerShell>,
    );

    const outsideButton = document.createElement("button");
    document.body.appendChild(outsideButton);

    try {
      expect(fireDrawerPointerDownOutside(outsideButton).defaultPrevented).toBe(
        false,
      );
    } finally {
      outsideButton.remove();
    }
  });
});

describe("PersistentResponsiveDrawerShell", () => {
  it("opens without applying modal state to the app tree", () => {
    mockPointerCoarse(true);
    const onContentAnimationEnd = vi.fn();
    const view = render(
      <>
        <main data-testid="large-app-tree" />
        <PersistentResponsiveDrawerShell
          open={false}
          onOpenChange={() => {}}
          srLabel="Details"
          onContentAnimationEnd={onContentAnimationEnd}
        >
          <button type="button">Panel action</button>
        </PersistentResponsiveDrawerShell>
      </>,
    );

    const appTree = screen.getByTestId("large-app-tree");
    const content = document.querySelector<HTMLElement>(
      "[data-persistent-drawer-content]",
    );
    expect(content).not.toBeNull();
    expect(content?.getAttribute("aria-hidden")).toBe("true");
    expect(appTree.getAttribute("aria-hidden")).toBeNull();
    expect(appTree.hasAttribute("inert")).toBe(false);

    view.rerender(
      <>
        <main data-testid="large-app-tree" />
        <PersistentResponsiveDrawerShell
          open={true}
          onOpenChange={() => {}}
          srLabel="Details"
          onContentAnimationEnd={onContentAnimationEnd}
        >
          <button type="button">Panel action</button>
        </PersistentResponsiveDrawerShell>
      </>,
    );

    expect(content?.getAttribute("aria-hidden")).toBe("false");
    expect(appTree.getAttribute("aria-hidden")).toBeNull();
    fireEvent.transitionEnd(content as HTMLElement, {
      propertyName: "transform",
    });
    expect(onContentAnimationEnd).toHaveBeenLastCalledWith(true);
  });

  it("closes from the backdrop and the Escape key", () => {
    mockPointerCoarse(true);
    const onOpenChange = vi.fn();
    render(
      <PersistentResponsiveDrawerShell
        open={true}
        onOpenChange={onOpenChange}
        srLabel="Details"
      >
        <button type="button">Panel action</button>
      </PersistentResponsiveDrawerShell>,
    );

    fireEvent.click(
      document.querySelector<HTMLElement>(
        "[data-persistent-drawer-backdrop]",
      ) as HTMLElement,
    );
    expect(onOpenChange).toHaveBeenLastCalledWith(false);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(onOpenChange).toHaveBeenCalledTimes(2);
  });

  it("lets a nested portaled surface handle Escape first", () => {
    mockPointerCoarse(true);
    const onOpenChange = vi.fn();
    render(
      <PersistentResponsiveDrawerShell
        open={true}
        onOpenChange={onOpenChange}
        srLabel="Details"
      >
        <button type="button">Panel action</button>
      </PersistentResponsiveDrawerShell>,
    );

    const nestedAction = document.createElement("button");
    nestedAction.addEventListener("keydown", (event) => {
      event.preventDefault();
    });
    document.body.appendChild(nestedAction);

    try {
      fireEvent.keyDown(nestedAction, { key: "Escape" });
      expect(onOpenChange).not.toHaveBeenCalled();
    } finally {
      nestedAction.remove();
    }
  });

  it("does not take Tab focus from a portaled child surface", () => {
    mockPointerCoarse(true);
    render(
      <PersistentResponsiveDrawerShell
        open={true}
        onOpenChange={() => {}}
        srLabel="Details"
      >
        <button type="button">Panel action</button>
      </PersistentResponsiveDrawerShell>,
    );

    const nestedAction = document.createElement("button");
    document.body.appendChild(nestedAction);
    nestedAction.focus();

    try {
      fireEvent.keyDown(nestedAction, { key: "Tab" });
      expect(document.activeElement).toBe(nestedAction);
      fireEvent.keyDown(nestedAction, { key: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(nestedAction);
    } finally {
      nestedAction.remove();
    }
  });

  it("keeps panel focus and uses the latest close callback after a parent rerender", () => {
    mockPointerCoarse(false);
    const requestAnimationFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(performance.now());
        return 1;
      });
    const firstOnOpenChange = vi.fn();
    const nextOnOpenChange = vi.fn();
    const view = render(
      <PersistentResponsiveDrawerShell
        open={true}
        onOpenChange={firstOnOpenChange}
        srLabel="Details"
      >
        <input aria-label="Panel input" />
      </PersistentResponsiveDrawerShell>,
    );
    const input = screen.getByRole("textbox", { name: "Panel input" });
    input.focus();

    view.rerender(
      <PersistentResponsiveDrawerShell
        open={true}
        onOpenChange={nextOnOpenChange}
        srLabel="Details"
      >
        <input aria-label="Panel input" />
      </PersistentResponsiveDrawerShell>,
    );

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(input);
    fireEvent.click(
      document.querySelector<HTMLElement>(
        "[data-persistent-drawer-backdrop]",
      ) as HTMLElement,
    );
    expect(firstOnOpenChange).not.toHaveBeenCalled();
    expect(nextOnOpenChange).toHaveBeenCalledWith(false);
    requestAnimationFrame.mockRestore();
  });

  it("closes when the handle moves past the drag threshold", () => {
    mockPointerCoarse(true);
    const onOpenChange = vi.fn();
    render(
      <PersistentResponsiveDrawerShell
        open={true}
        onOpenChange={onOpenChange}
        srLabel="Details"
      >
        <button type="button">Panel action</button>
      </PersistentResponsiveDrawerShell>,
    );

    const content = document.querySelector<HTMLElement>(
      "[data-persistent-drawer-content]",
    ) as HTMLElement;
    const handle = document.querySelector<HTMLElement>(
      "[data-persistent-drawer-handle]",
    ) as HTMLElement;
    const readHeight = vi.fn(() => 400);
    Object.defineProperty(content, "clientHeight", {
      configurable: true,
      get: readHeight,
    });
    handle.setPointerCapture = vi.fn();

    fireEvent.pointerDown(handle, {
      button: 0,
      clientY: 200,
      pointerId: 1,
    });
    fireEvent.pointerMove(handle, { clientY: 330, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 330, pointerId: 1 });

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(readHeight).toHaveBeenCalledTimes(1);
  });
});
