const SEARCH_FLASH_CLASS = "bb-search-flash";
const SEARCH_FLASH_DURATION_MS = 1700;

const flashTimers = new WeakMap<HTMLElement, number>();

export function flashSearchTarget(element: HTMLElement): void {
  window.clearTimeout(flashTimers.get(element));
  if (element.classList.contains(SEARCH_FLASH_CLASS)) {
    element.classList.remove(SEARCH_FLASH_CLASS);
    void element.offsetWidth;
  }
  element.classList.add(SEARCH_FLASH_CLASS);
  flashTimers.set(
    element,
    window.setTimeout(() => {
      element.classList.remove(SEARCH_FLASH_CLASS);
      flashTimers.delete(element);
    }, SEARCH_FLASH_DURATION_MS),
  );
}
