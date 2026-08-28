// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImperativePanelGroupHandle } from "react-resizable-panels";
import type { MotionValue, ValueAnimationTransition } from "motion";
import {
  SECONDARY_PANEL_BOUNDARY_SAFE_WIDTH_PX,
  createSecondaryPanelGroupMotion,
  type SecondaryPanelGroupMotionDependencies,
} from "./secondaryPanelGroupMotion";

type RecordedAnimation = {
  options: ValueAnimationTransition<number>;
  stop: ReturnType<typeof vi.fn>;
  target: number;
  value: MotionValue<number>;
};

type MotionAnimationState = {
  calls: RecordedAnimation[];
};

const motionAnimationState: MotionAnimationState = {
  calls: [],
};

const testMotionDependencies: SecondaryPanelGroupMotionDependencies = {
  animate: (value, target, options) => {
    const stop = vi.fn();
    motionAnimationState.calls.push({ options, stop, target, value });
    return { stop };
  },
};

function createHarness() {
  const groupId = "right-panel-group";
  const groupElement = document.createElement("div");
  groupElement.setAttribute("data-panel-group", "");
  groupElement.setAttribute("data-panel-group-id", groupId);
  const measureGroup = vi
    .spyOn(groupElement, "getBoundingClientRect")
    .mockReturnValue(
      // SAFETY: The fixture supplies the DOMRect width that the source reads.
      { width: 800 } as DOMRect,
    );
  const panels = [document.createElement("div"), document.createElement("div")];
  for (const panel of panels) {
    panel.setAttribute("data-panel", "");
    panel.setAttribute("data-panel-group-id", groupId);
    groupElement.append(panel);
  }
  const boundary = document.createElement("div");
  boundary.setAttribute("data-panel-resize-handle-id", "right-panel-handle");
  boundary.setAttribute("data-secondary-panel-boundary", "");
  boundary.setAttribute("data-panel-group-id", groupId);
  groupElement.insertBefore(boundary, panels[1] ?? null);
  document.body.append(groupElement);

  let layout = [100, 0];
  const group: ImperativePanelGroupHandle = {
    getId: () => groupId,
    getLayout: () => layout,
    setLayout: vi.fn((nextLayout) => {
      layout = nextLayout;
      panels.forEach((panel, index) => {
        panel.style.flexBasis = "0px";
        panel.style.flexGrow = String(nextLayout[index]);
      });
    }),
  };
  group.setLayout(layout);

  return { boundary, group, measureGroup, panels };
}

afterEach(() => {
  motionAnimationState.calls.length = 0;
  document.body.replaceChildren();
});

describe("createSecondaryPanelGroupMotion", () => {
  it("hides the opening boundary until the panel clears the fixed toggle", () => {
    const { boundary, group } = createHarness();
    const motion = createSecondaryPanelGroupMotion(testMotionDependencies);

    motion.setLayout(group, [60, 40], false);

    const animation = motionAnimationState.calls[0];
    const safePercent = (SECONDARY_PANEL_BOUNDARY_SAFE_WIDTH_PX / 800) * 100;
    expect(animation).toMatchObject({
      target: 40,
      options: { type: "spring", duration: 0.5, bounce: 0.1 },
    });
    animation?.value.set(safePercent - 0.01);
    expect(boundary.style.opacity).toBe("0");
    animation?.value.set(safePercent);
    expect(boundary.style.opacity).toBe("1");
  });

  it("keeps the disabled boundary hidden at the full-width layout", () => {
    const { boundary, group } = createHarness();
    const motion = createSecondaryPanelGroupMotion(testMotionDependencies);

    motion.setLayout(group, [60, 40], false);
    const animation = motionAnimationState.calls[0];
    animation?.value.set(40);
    animation?.options.onComplete?.();
    expect(boundary.style.opacity).toBe("1");

    motion.setLayout(group, [0, 100], false);
    const collapsing = motionAnimationState.calls[1];
    collapsing?.value.set(99);
    expect(boundary.style.opacity).toBe("1");
    collapsing?.value.set(100);
    expect(boundary.style.opacity).toBe("0");
    collapsing?.options.onComplete?.();
    expect(boundary.style.opacity).toBe("0");
  });

  it("measures the group once per layout instead of on every frame", () => {
    const { group, measureGroup } = createHarness();
    const motion = createSecondaryPanelGroupMotion(testMotionDependencies);

    motion.setLayout(group, [60, 40], false);
    const measurementsAfterStart = measureGroup.mock.calls.length;

    const animation = motionAnimationState.calls[0];
    animation?.value.set(10);
    animation?.value.set(20);
    animation?.value.set(40);
    animation?.options.onComplete?.();

    expect(measureGroup.mock.calls.length).toBe(measurementsAfterStart);
  });

  it("restarts an interrupted layout from its rendered flex values", () => {
    const { group, panels } = createHarness();
    const motion = createSecondaryPanelGroupMotion(testMotionDependencies);

    motion.setLayout(group, [60, 40], false);
    const openingAnimation = motionAnimationState.calls[0];
    openingAnimation?.value.set(30);
    motion.setLayout(group, [100, 0], false);

    const closingAnimation = motionAnimationState.calls[1];
    expect(closingAnimation?.value).toBe(openingAnimation?.value);
    expect(closingAnimation?.target).toBe(0);
    expect(panels[0]?.style.flexGrow).toBe("70");
    expect(panels[1]?.style.flexGrow).toBe("30");
  });

  it("starts closing from the width applied by a resize drag", () => {
    const { group, panels } = createHarness();
    const motion = createSecondaryPanelGroupMotion(testMotionDependencies);

    motion.setLayout(group, [60, 40], false);
    const openingAnimation = motionAnimationState.calls[0];
    openingAnimation?.value.set(40);
    openingAnimation?.options.onComplete?.();

    group.setLayout([65, 35]);
    motion.setLayout(group, [100, 0], false);

    const closingAnimation = motionAnimationState.calls[1];
    expect(closingAnimation?.value.get()).toBe(35);
    expect(panels[0]?.style.flexGrow).toBe("65");
    expect(panels[1]?.style.flexGrow).toBe("35");
  });

  it("defers the panel library's target layout until Motion completes", () => {
    const { group } = createHarness();
    const motion = createSecondaryPanelGroupMotion(testMotionDependencies);

    motion.setLayout(group, [60, 40], false);

    expect(group.getLayout()).toEqual([100, 0]);
    motionAnimationState.calls[0]?.options.onComplete?.();
    expect(group.getLayout()).toEqual([60, 40]);
  });
});
