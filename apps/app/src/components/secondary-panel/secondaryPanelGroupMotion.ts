import {
  getPanelElementsForGroup,
  getPanelGroupElement,
  getResizeHandleElementsForGroup,
  type ImperativePanelGroupHandle,
} from "react-resizable-panels";
import {
  animate,
  motionValue,
  type MotionValue,
  type ValueAnimationTransition,
} from "motion";
import { PANEL_SPRING_TRANSITION } from "@/lib/panel-motion";

export const SECONDARY_PANEL_BOUNDARY_SAFE_WIDTH_PX = 80;

const FULL_SIZE_PERCENT = 100;
const FALLBACK_BOUNDARY_SAFE_SIZE_PERCENT = 10;

export type SecondaryPanelGroupMotion = {
  setLayout: (
    group: ImperativePanelGroupHandle,
    layout: readonly [mainSize: number, secondarySize: number],
    instant: boolean,
  ) => void;
  stop: () => void;
};

export interface SecondaryPanelGroupMotionDependencies {
  animate: (
    value: MotionValue<number>,
    target: number,
    options: ValueAnimationTransition<number>,
  ) => { stop: () => void };
}

const defaultSecondaryPanelGroupMotionDependencies: SecondaryPanelGroupMotionDependencies =
  {
    animate,
  };

type PanelGroupElements = {
  boundaries: HTMLElement[];
  groupWidth: number;
  panels: [HTMLElement, HTMLElement];
};

function findGroupElements(
  group: ImperativePanelGroupHandle,
): PanelGroupElements | null {
  const groupId = group.getId();
  const groupElement = getPanelGroupElement(groupId);
  if (groupElement === null) return null;

  const panels = getPanelElementsForGroup(groupId, groupElement);
  const mainPanel = panels[0];
  const secondaryPanel = panels[1];
  if (mainPanel === undefined || secondaryPanel === undefined) return null;

  return {
    panels: [mainPanel, secondaryPanel],
    groupWidth: groupElement.getBoundingClientRect().width,
    boundaries: getResizeHandleElementsForGroup(groupId, groupElement).filter(
      (element) => element.hasAttribute("data-secondary-panel-boundary"),
    ),
  };
}

function readFlexGrow(element: HTMLElement): number {
  const value = Number(window.getComputedStyle(element).flexGrow);
  return Number.isFinite(value) ? value : 0;
}

function renderPanelGroup(
  { boundaries, groupWidth, panels }: PanelGroupElements,
  secondarySize: number,
): void {
  const size = Math.min(FULL_SIZE_PERCENT, Math.max(0, secondarySize));
  panels[0].style.flexGrow = String(FULL_SIZE_PERCENT - size);
  panels[1].style.flexGrow = String(size);

  const safeSize =
    groupWidth > 0
      ? (SECONDARY_PANEL_BOUNDARY_SAFE_WIDTH_PX / groupWidth) * 100
      : FALLBACK_BOUNDARY_SAFE_SIZE_PERCENT;
  const isBoundaryShowing = size >= safeSize && size < FULL_SIZE_PERCENT;
  const opacity = isBoundaryShowing ? "1" : "0";
  for (const boundary of boundaries) boundary.style.opacity = opacity;
}

export function createSecondaryPanelGroupMotion(
  dependencies = defaultSecondaryPanelGroupMotionDependencies,
): SecondaryPanelGroupMotion {
  const secondarySize = motionValue(0);
  let elements: PanelGroupElements | null = null;
  let revision = 0;
  secondarySize.on("change", (size) => {
    if (elements !== null) renderPanelGroup(elements, size);
  });

  const clearBinding = () => {
    revision += 1;
    secondarySize.stop();
    elements = null;
  };

  return {
    setLayout: (group, layout, instant) => {
      const nextElements = findGroupElements(group);
      const targetSize = layout[1];
      if (nextElements === null) {
        clearBinding();
        group.setLayout([...layout]);
        return;
      }

      elements = nextElements;
      secondarySize.jump(readFlexGrow(elements.panels[1]));

      const currentSize = secondarySize.get();
      renderPanelGroup(elements, currentSize);
      if (instant || currentSize === targetSize) {
        revision += 1;
        secondarySize.stop();
        group.setLayout([...layout]);
        secondarySize.jump(targetSize);
        renderPanelGroup(elements, targetSize);
        return;
      }

      const currentRevision = ++revision;
      dependencies.animate(secondarySize, targetSize, {
        ...PANEL_SPRING_TRANSITION,
        onComplete: () => {
          if (revision !== currentRevision || elements === null) return;
          group.setLayout([...layout]);
          renderPanelGroup(elements, targetSize);
        },
      });
    },
    stop: clearBinding,
  };
}
