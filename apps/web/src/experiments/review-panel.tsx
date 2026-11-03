// Review build only. This file lives on the integration branch that combines
// every homepage PR for owner review and is never merged.
import { useEffect, useState } from "react";

import { EXPERIMENT_KEYS, EXPERIMENT_VARIANTS, type ExperimentKey } from "./flags";
import { useExperimentBootstrap } from "./use-experiment";

const LABELS: Partial<Record<ExperimentKey | string, string>> = {
  "homepage-sticky-header": "Sticky header",
  "homepage-header-download": "Header Download button",
  "homepage-download-area": "Download area",
  "homepage-subhead-text": "Subhead text",
  "homepage-hero-window": "Hero window",
  "homepage-below-fold": "Below the fold",
  "homepage-phone-email": "Phone email link",
};

const HIDDEN = new Set(["homepage-qa-check", "homepage-aa"]);

export function ReviewPanel() {
  const bootstrap = useExperimentBootstrap();
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (window.innerWidth < 700) setOpen(false);
  }, []);
  if (!bootstrap.preview) return null;
  const keys = EXPERIMENT_KEYS.filter((key) => !HIDDEN.has(key));
  const current = (key: ExperimentKey) =>
    bootstrap.featureFlags[key] === EXPERIMENT_VARIANTS[key][0] ? "new" : "control";
  const go = (next: Record<string, "new" | "control">) => {
    const url = new URL(window.location.href);
    url.searchParams.delete("ph_flag");
    for (const key of keys) {
      const arm = next[key] ?? current(key);
      url.searchParams.append(
        "ph_flag",
        `${key}:${arm === "new" ? EXPERIMENT_VARIANTS[key][0] : "control"}`,
      );
    }
    window.location.assign(url.toString());
  };
  const all = (arm: "new" | "control") =>
    go(Object.fromEntries(keys.map((key) => [key, arm])));
  return (
    <aside className="review-panel" data-open={open}>
      <button type="button" className="review-panel-toggle" onClick={() => setOpen(!open)}>
        {open ? "Hide" : "Review build"}
      </button>
      {open ? (
        <>
          <strong>Review build · every experiment</strong>
          <ul>
            {keys.map((key) => (
              <li key={key}>
                <span>{LABELS[key] ?? key}</span>
                <span className="review-panel-seg">
                  {(["control", "new"] as const).map((arm) => (
                    <button
                      type="button"
                      key={arm}
                      aria-pressed={current(key) === arm}
                      onClick={() => go({ [key]: arm })}
                    >
                      {arm === "new" ? "New" : "Control"}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          <YoursSwitch />
          <span className="review-panel-all">
            <button type="button" onClick={() => all("new")}>All new</button>
            <button type="button" onClick={() => all("control")}>All control</button>
          </span>
        </>
      ) : null}
    </aside>
  );
}

const YOURS_OPTIONS = [
  ["morph", "Changing window"],
  ["browse", "Browse hero"],
  ["marketplace", "Marketplace"],
] as const;

function YoursSwitch() {
  const [current, setCurrent] = useState("morph");
  useEffect(() => {
    setCurrent(
      window.location.host.includes("61033")
        ? "browse"
        : (new URLSearchParams(window.location.search).get("yours") ?? "morph"),
    );
  }, []);
  const pick = (value: string) => {
    // The Browse hero version replaces the marketplace graphic's code, so it
    // runs as a second review build on the next port.
    const url = new URL(window.location.href);
    url.host = url.host.replace(
      value === "browse" ? "61032" : "61033",
      value === "browse" ? "61033" : "61032",
    );
    url.searchParams.set("yours", value);
    window.location.assign(url.toString());
  };
  return (
    <ul>
      <li>
        <span>Make bb yours graphic</span>
      </li>
      <li>
        <span className="review-panel-seg">
          {YOURS_OPTIONS.map(([value, label]) => (
            <button
              type="button"
              key={value}
              aria-pressed={current === value}
              onClick={() => pick(value)}
            >
              {label}
            </button>
          ))}
        </span>
      </li>
    </ul>
  );
}
