import { useSyncExternalStore } from "react";

const GOOGLE_ADS_ID = "AW-18496599474";
const DOWNLOAD_CONVERSION = `${GOOGLE_ADS_ID}/GV6QCOSxnJYdELLr7vNE`;
const GTAG_SRC = `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_ID}`;
const AD_CLICK_KEY = "bb:ads-click-landing";
const CONSENT_KEY = "bb:ads-consent";
const AD_CLICK_PARAMS = ["gclid", "gbraid", "wbraid"] as const;
const DOWNLOAD_PATH_PREFIX = "/download/";

export const CONSENT_REGIONS = [
  "AT",
  "BE",
  "BG",
  "CH",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GB",
  "GR",
  "HR",
  "HU",
  "IE",
  "IS",
  "IT",
  "LI",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "NO",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK",
] as const;

const NO_CONSENT_NEEDED = new Set<string>(["US", "CA", "AU", "NZ"]);

export type AdsConsentChoice = "granted" | "denied";

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

export function isAdClickLanding(search: string): boolean {
  const params = new URLSearchParams(search);
  return AD_CLICK_PARAMS.some((name) => params.get(name));
}

export function consentRequiredForCountry(country: string | null): boolean {
  return !NO_CONSENT_NEEDED.has((country ?? "").toUpperCase());
}

export function isDownloadLink(
  target: EventTarget | null,
  origin: string,
): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  const link = target.closest("a");
  return (
    link instanceof HTMLAnchorElement &&
    link.origin === origin &&
    link.pathname.startsWith(DOWNLOAD_PATH_PREFIX)
  );
}

let started = false;
let loaded = false;
let configured = false;
let landingUrl: string | null = null;
let promptShown = false;
const promptListeners = new Set<() => void>();

function setPromptShown(shown: boolean): void {
  promptShown = shown;
  for (const listener of promptListeners) {
    listener();
  }
}

function gtag(..._args: unknown[]): void {
  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push(arguments);
}

function countDownloadClick(event: MouseEvent): void {
  if (!landingUrl || !isDownloadLink(event.target, window.location.origin)) {
    return;
  }
  if (!configured) {
    configured = true;
    gtag("config", GOOGLE_ADS_ID, {
      send_page_view: false,
      allow_ad_personalization_signals: false,
      page_location: landingUrl,
    });
  }
  gtag("event", "conversion", {
    send_to: DOWNLOAD_CONVERSION,
    transport_type: "beacon",
  });
}

function loadGoogleAds(consented: boolean): void {
  if (loaded) {
    return;
  }
  loaded = true;
  gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "denied",
    region: CONSENT_REGIONS,
  });
  gtag("consent", "default", {
    ad_storage: "granted",
    ad_user_data: "granted",
    ad_personalization: "denied",
    analytics_storage: "denied",
  });
  if (consented) {
    gtag("consent", "update", {
      ad_storage: "granted",
      ad_user_data: "granted",
    });
  }
  gtag("js", new Date());
  const script = document.createElement("script");
  script.async = true;
  script.src = GTAG_SRC;
  document.head.appendChild(script);
  document.addEventListener("click", countDownloadClick, true);
}

async function fetchConsentRequired(): Promise<boolean> {
  try {
    const response = await fetch("/api/ads-consent", { cache: "no-store" });
    const body: unknown = await response.json();
    return !(
      typeof body === "object" &&
      body !== null &&
      "required" in body &&
      body.required === false
    );
  } catch {
    return true;
  }
}

export function initAdsConversion(): void {
  if (started || typeof window === "undefined") {
    return;
  }
  started = true;
  let choice: string | null;
  try {
    if (isAdClickLanding(window.location.search)) {
      window.sessionStorage.setItem(AD_CLICK_KEY, window.location.href);
    }
    landingUrl = window.sessionStorage.getItem(AD_CLICK_KEY);
    choice = window.localStorage.getItem(CONSENT_KEY);
  } catch {
    return;
  }
  if (!landingUrl || choice === "denied") {
    return;
  }
  void fetchConsentRequired().then((required) => {
    if (!required) {
      loadGoogleAds(false);
    } else if (choice === "granted") {
      loadGoogleAds(true);
    } else {
      setPromptShown(true);
    }
  });
}

export function chooseAdsConsent(choice: AdsConsentChoice): void {
  try {
    window.localStorage.setItem(CONSENT_KEY, choice);
  } catch {}
  setPromptShown(false);
  if (choice === "granted" && landingUrl) {
    loadGoogleAds(true);
  }
}

function subscribePrompt(listener: () => void): () => void {
  promptListeners.add(listener);
  return () => {
    promptListeners.delete(listener);
  };
}

export function useAdsConsentPrompt(): boolean {
  return useSyncExternalStore(
    subscribePrompt,
    () => promptShown,
    () => false,
  );
}
