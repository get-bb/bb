import { CAMPAIGN_PARAM_NAMES } from "./site";

const SAVED_UTM_KEY = "bb:landing-utm";
const DOWNLOAD_PATH_PREFIX = "/download/";
const CARRY_EVENTS = ["pointerdown", "click"] as const;

type UtmStorage = Pick<Storage, "getItem" | "setItem">;

export function pickUtmParams(search: string): URLSearchParams {
  const params = new URLSearchParams(search);
  const utm = new URLSearchParams();
  for (const name of CAMPAIGN_PARAM_NAMES) {
    const value = params.get(name);
    if (value) {
      utm.set(name, value);
    }
  }
  return utm;
}

export function addSavedUtmParams(
  search: string,
  saved: URLSearchParams,
): string {
  if (pickUtmParams(search).toString() || !saved.toString()) {
    return search;
  }
  const params = new URLSearchParams(search);
  for (const [name, value] of saved) {
    params.set(name, value);
  }
  return `?${params.toString()}`;
}

export function rememberLatestUtm(storage: UtmStorage, search: string): void {
  const utm = pickUtmParams(search).toString();
  if (utm) {
    storage.setItem(SAVED_UTM_KEY, utm);
  }
}

export function readSavedUtm(storage: UtmStorage): URLSearchParams {
  return pickUtmParams(storage.getItem(SAVED_UTM_KEY) ?? "");
}

export function carryUtmToDownloadLinks(): () => void {
  const globalPrivacyControl =
    "globalPrivacyControl" in navigator &&
    navigator.globalPrivacyControl === true;
  if (globalPrivacyControl) {
    const landingUrl = new URL(window.location.href);
    if (landingUrl.searchParams.has("gclid")) {
      landingUrl.searchParams.delete("gclid");
      window.history.replaceState(window.history.state, "", landingUrl.href);
    }
  }
  let storage: UtmStorage | null = null;
  try {
    storage = window.sessionStorage;
    const landingParams = new URLSearchParams(window.location.search);
    if (globalPrivacyControl) {
      const saved = readSavedUtm(storage);
      saved.delete("gclid");
      storage.setItem(SAVED_UTM_KEY, saved.toString());
      landingParams.delete("gclid");
    }
    rememberLatestUtm(storage, landingParams.toString());
  } catch {
    storage = null;
  }

  const carry = (event: Event) => {
    if (!(event.target instanceof Element)) {
      return;
    }
    const link = event.target.closest("a");
    if (
      !(link instanceof HTMLAnchorElement) ||
      link.origin !== window.location.origin ||
      !link.pathname.startsWith(DOWNLOAD_PATH_PREFIX)
    ) {
      return;
    }
    let saved = new URLSearchParams();
    try {
      if (storage) {
        saved = readSavedUtm(storage);
      }
    } catch {
      storage = null;
    }
    let linkSearch = link.search;
    if (globalPrivacyControl) {
      saved.delete("gclid");
      const params = new URLSearchParams(linkSearch);
      params.delete("gclid");
      const query = params.toString();
      linkSearch = query ? `?${query}` : "";
    }
    const search = addSavedUtmParams(linkSearch, saved);
    if (search !== link.search) {
      link.search = search;
    }
  };

  for (const type of CARRY_EVENTS) {
    document.addEventListener(type, carry, true);
  }
  return () => {
    for (const type of CARRY_EVENTS) {
      document.removeEventListener(type, carry, true);
    }
  };
}
