import type { BottomAnchorContextValue } from "@/components/ui/bottom-anchored-scroll-body.js";

const flashTimers = new WeakMap<HTMLElement, number>();

export function revealTimelineRow(
  element: HTMLElement,
  bottomAnchor: BottomAnchorContextValue | null,
  flash = true,
) {
  const options = { block: "start", inline: "nearest" } as const;
  if (bottomAnchor !== null) {
    bottomAnchor.scrollElementIntoView({ element, options });
  } else {
    element.scrollIntoView(options);
  }
  if (!flash) return;

  window.clearTimeout(flashTimers.get(element));
  if (element.classList.contains("bb-search-flash")) {
    element.classList.remove("bb-search-flash");
    void element.offsetWidth;
  }
  element.classList.add("bb-search-flash");
  flashTimers.set(
    element,
    window.setTimeout(() => {
      element.classList.remove("bb-search-flash");
      flashTimers.delete(element);
    }, 1700),
  );
}
