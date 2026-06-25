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

const drawerContentState = vi.hoisted(() => ({
  fireAnimationEnd: undefined as CapturedAnimationEnd | undefined,
  fireOpenAutoFocus: undefined as ((event: Event) => void) | undefined,
}));

vi.mock("./drawer.js", async () => {
  const React = await import("react");

  const Drawer = ({ children }: { children: ReactNode }) =>
    React.createElement("div", { "data-testid": "drawer" }, children);

  interface MockDrawerContentProps extends HTMLAttributes<HTMLDivElement> {
    onOpenAutoFocus?: (event: Event) => void;
  }

  const DrawerContent = React.forwardRef<HTMLDivElement, MockDrawerContentProps>(
    ({ children, onAnimationEnd, onOpenAutoFocus, ...props }, ref) => {
      drawerContentState.fireAnimationEnd = ({ currentTarget, target }) => {
        onAnimationEnd?.({
          currentTarget,
          target,
        } as ReactAnimationEvent<HTMLDivElement>);
      };
      drawerContentState.fireOpenAutoFocus = onOpenAutoFocus;

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
});
