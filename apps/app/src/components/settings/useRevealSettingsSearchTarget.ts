import { useEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { flashSearchTarget } from "@/lib/search-flash";
import { readSettingsSearchAnchor } from "./settings-search";

const SETTINGS_SEARCH_REVEAL_TIMEOUT_MS = 5000;

function findSettingsSearchAnchor(anchor: string): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(
    "[data-settings-anchor]",
  )) {
    if (element.dataset.settingsAnchor === anchor) return element;
  }
  return null;
}

function revealSettingsSearchAnchor(anchor: string): boolean {
  const element = findSettingsSearchAnchor(anchor);
  if (element === null) return false;
  element.scrollIntoView({
    block: element.tagName === "SECTION" ? "start" : "center",
  });
  flashSearchTarget(element);
  return true;
}

export function useRevealSettingsSearchTarget(): void {
  const location = useLocation();
  const navigationType = useNavigationType();
  const anchor =
    navigationType === "POP" ? null : readSettingsSearchAnchor(location.state);
  const locationKey = location.key;

  useEffect(() => {
    if (anchor === null || revealSettingsSearchAnchor(anchor)) return;
    const stop = () => {
      observer.disconnect();
      window.clearTimeout(timeout);
    };
    const observer = new MutationObserver(() => {
      if (revealSettingsSearchAnchor(anchor)) stop();
    });
    const timeout = window.setTimeout(stop, SETTINGS_SEARCH_REVEAL_TIMEOUT_MS);
    observer.observe(document.body, { childList: true, subtree: true });
    return stop;
  }, [anchor, locationKey]);
}
