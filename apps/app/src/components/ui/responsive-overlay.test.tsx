// @vitest-environment jsdom

import type {
  AnimationEvent as ReactAnimationEvent,
  HTMLAttributes,
  ReactNode,
} from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POINTER_COARSE_QUERY } from "./hooks/use-pointer-coarse";
import { ResponsiveDrawerShell } from "./responsive-overlay";

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

  const DrawerContent = React.forwardRef<HTMLDivElement, MockDrawerContentProps>(
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
      expect(
        fireDrawerPointerDownOutside(outsideButton).defaultPrevented,
      ).toBe(false);
    } finally {
      outsideButton.remove();
    }
  });
});
