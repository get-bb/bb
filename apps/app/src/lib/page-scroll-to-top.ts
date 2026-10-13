export const PAGE_SCROLL_TO_TOP_EVENT = "bb:page-scroll-to-top";

export function scrollPageToTop(header: HTMLElement) {
  let scope = header.parentElement;
  while (scope) {
    const viewport = Array.from(
      scope.querySelectorAll<HTMLElement>("[data-page-scroll-viewport]"),
    ).find((element) => element.getClientRects().length > 0);
    if (viewport) {
      const event = new Event(PAGE_SCROLL_TO_TOP_EVENT, { cancelable: true });
      if (viewport.dispatchEvent(event)) {
        viewport.scrollTo({
          top: 0,
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "instant"
            : "smooth",
        });
      }
      return;
    }
    scope = scope.parentElement;
  }
}
