import {
  getPanelElementsForGroup,
  getPanelGroupElement,
  getResizeHandleElementsForGroup,
  type ImperativePanelGroupHandle,
} from "react-resizable-panels";
import { animate, motionValue } from "motion";
import { PANEL_SPRING_TRANSITION } from "@/lib/panel-motion";

export const SECONDARY_PANEL_BOUNDARY_SAFE_WIDTH_PX = 80;

export type SecondaryPanelGroupMotion = {
  setLayout: (
    group: ImperativePanelGroupHandle,
    layout: readonly [mainSize: number, secondarySize: number],
    instant: boolean,
  ) => void;
  stop: () => void;
};

type PanelGroupElements = {
  boundaries: HTMLElement[];
  group: HTMLElement;
  panels: [HTMLElement, HTMLElement];
};

function findGroupElements(
  group: ImperativePanelGroupHandle,
): PanelGroupElements | null {
  if (typeof group.getId !== "function") return null;
  const groupId = group.getId();
  const groupElement = getPanelGroupElement(groupId);
  if (groupElement === null) return null;

  const panels = getPanelElementsForGroup(groupId, groupElement);
  const mainPanel = panels[0];
  const secondaryPanel = panels[1];
  if (mainPanel === undefined || secondaryPanel === undefined) return null;

  return {
    panels: [mainPanel, secondaryPanel],
    group: groupElement,
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
  { boundaries, group, panels }: PanelGroupElements,
  secondarySize: number,
): void {
  const size = Math.min(100, Math.max(0, secondarySize));
  panels[0].style.flexGrow = String(100 - size);
  panels[1].style.flexGrow = String(size);

  const groupWidth = group.getBoundingClientRect().width;
  const safeSize =
    groupWidth > 0
      ? (SECONDARY_PANEL_BOUNDARY_SAFE_WIDTH_PX / groupWidth) * 100
      : 10;
  const opacity = size >= safeSize ? "1" : "0";
  for (const boundary of boundaries) boundary.style.opacity = opacity;
}

export function createSecondaryPanelGroupMotion(): SecondaryPanelGroupMotion {
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

      const panelsChanged =
        elements === null ||
        elements.panels[0] !== nextElements.panels[0] ||
        elements.panels[1] !== nextElements.panels[1];
      elements = nextElements;
      if (panelsChanged) {
        secondarySize.jump(readFlexGrow(elements.panels[1]));
      }

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
      animate(secondarySize, targetSize, {
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
