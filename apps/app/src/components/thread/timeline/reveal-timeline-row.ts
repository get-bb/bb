import type { BottomAnchorContextValue } from "@/components/ui/bottom-anchored-scroll-body.js";
import { flashSearchTarget } from "@/lib/search-flash";

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

  flashSearchTarget(element);
}
