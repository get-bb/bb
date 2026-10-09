import { chooseAdsConsent, useAdsConsentPrompt } from "./google-ads";

export function AdsConsentPrompt() {
  const shown = useAdsConsentPrompt();
  if (!shown) {
    return null;
  }
  return (
    <aside className="ads-consent" aria-label="Ad measurement">
      <p>
        Allow Google Ads to count downloads from our ads? Nothing else is
        tracked. <a href="/privacy#google-ads">Privacy</a>
      </p>
      <div className="ads-consent-actions">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => chooseAdsConsent("denied")}
        >
          No thanks
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => chooseAdsConsent("granted")}
        >
          Allow
        </button>
      </div>
    </aside>
  );
}
