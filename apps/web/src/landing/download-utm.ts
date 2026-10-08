import { UTM_PARAM_NAMES } from "./site";

const SAVED_UTM_KEY = "bb:landing-utm";
const DOWNLOAD_PATH_PREFIX = "/download/";
const CARRY_EVENTS = ["pointerdown", "click"] as const;

type UtmStorage = Pick<Storage, "getItem" | "setItem">;

export function pickUtmParams(search: string): URLSearchParams {
  const params = new URLSearchParams(search);
  const utm = new URLSearchParams();
  for (const name of UTM_PARAM_NAMES) {
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
  let storage: UtmStorage;
  try {
    storage = window.sessionStorage;
    rememberLatestUtm(storage, window.location.search);
  } catch {
    return () => {};
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
    const search = addSavedUtmParams(link.search, readSavedUtm(storage));
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
