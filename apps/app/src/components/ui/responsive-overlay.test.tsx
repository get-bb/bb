// @vitest-environment jsdom

import type {
  AnimationEvent as ReactAnimationEvent,
  HTMLAttributes,
  ReactNode,
} from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResponsiveDrawerShell } from "./responsive-overlay";

type CapturedAnimationEnd = (args: {
  currentTarget: HTMLElement;
  target: EventTarget;
}) => void;

const drawerContentState = vi.hoisted(() => ({
  fireAnimationEnd: undefined as CapturedAnimationEnd | undefined,
}));

vi.mock("./drawer.js", async () => {
  const React = await import("react");

  const Drawer = ({ children }: { children: ReactNode }) =>
    React.createElement("div", { "data-testid": "drawer" }, children);

  const DrawerContent = React.forwardRef<
    HTMLDivElement,
    HTMLAttributes<HTMLDivElement>
  >(({ children, onAnimationEnd, ...props }, ref) => {
    drawerContentState.fireAnimationEnd = ({ currentTarget, target }) => {
      onAnimationEnd?.({
        currentTarget,
        target,
      } as ReactAnimationEvent<HTMLDivElement>);
    };

    return React.createElement(
      "div",
      { ...props, ref, "data-testid": "drawer-content" },
      children,
    );
  });
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
});
