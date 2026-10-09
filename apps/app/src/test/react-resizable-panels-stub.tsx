import {
  forwardRef,
  useImperativeHandle,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { vi } from "vitest";

export const panelGroupState = {
  getLayout: vi.fn((): number[] => [60, 40]),
  setLayout: vi.fn((_layout: number[]) => {}),
};

export const PanelGroup = forwardRef<
  typeof panelGroupState,
  HTMLAttributes<HTMLDivElement>
>(({ children, ...props }, ref) => {
  useImperativeHandle(ref, () => panelGroupState, []);
  return (
    <div {...props} data-testid="panel-group">
      {children}
    </div>
  );
});
PanelGroup.displayName = "MockPanelGroup";

export function Panel({ children }: { children?: ReactNode }) {
  return <div data-testid="panel">{children}</div>;
}

export function PanelResizeHandle({ children }: { children?: ReactNode }) {
  return <div>{children}</div>;
}
