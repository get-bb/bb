import { CAMPAIGN_PARAM_NAMES, CLICK_ID_PARAM_NAMES } from "./site";

const SAVED_UTM_KEY = "bb:landing-utm";
const DOWNLOAD_PATH = /^\/download\/(macos|windows|linux)$/;
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
    for (const name of CLICK_ID_PARAM_NAMES) {
      landingUrl.searchParams.delete(name);
    }
    if (landingUrl.href !== window.location.href) {
      window.history.replaceState(window.history.state, "", landingUrl.href);
    }
  }
  let storage: UtmStorage | null = null;
  try {
    storage = window.sessionStorage;
    const landingParams = new URLSearchParams(window.location.search);
    if (globalPrivacyControl) {
      const saved = readSavedUtm(storage);
      for (const name of CLICK_ID_PARAM_NAMES) {
        saved.delete(name);
        landingParams.delete(name);
      }
      storage.setItem(SAVED_UTM_KEY, saved.toString());
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
      !DOWNLOAD_PATH.test(link.pathname)
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
      const params = new URLSearchParams(linkSearch);
      for (const name of CLICK_ID_PARAM_NAMES) {
        saved.delete(name);
        params.delete(name);
      }
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
