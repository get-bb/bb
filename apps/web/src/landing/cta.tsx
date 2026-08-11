import {
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { trackLandingEvent } from "./analytics";
import type { CtaPlacement } from "./site";
import {
  DISCORD_URL,
  GITHUB_URL,
  PRODUCT_HUNT_URL,
  SUBSCRIBE_PATH,
  downloadMacosHref,
} from "./site";

/* Marketing CTAs shared by the landing page and the changelog. */

type CtaLinkProps = {
  placement: CtaPlacement;
  /** Omit for a plain inline link (nav/footer); set for button-styled CTAs. */
  className?: string;
  children: ReactNode;
};

export function DownloadLink({ placement, className, children }: CtaLinkProps) {
  return (
    <a className={className} href={downloadMacosHref(placement)}>
      {children}
    </a>
  );
}

export function GitHubLink({ placement, className, children }: CtaLinkProps) {
  return (
    <a
      className={className}
      href={GITHUB_URL}
      target="_blank"
      rel="noreferrer"
      onClick={() =>
        trackLandingEvent({
          name: "landing_github_clicked",
          properties: { placement },
        })
      }
    >
      {children}
    </a>
  );
}

export function DiscordLink({ placement, className, children }: CtaLinkProps) {
  return (
    <a
      className={className}
      href={DISCORD_URL}
      target="_blank"
      rel="noreferrer"
      onClick={() =>
        trackLandingEvent({
          name: "landing_discord_clicked",
          properties: { placement },
        })
      }
    >
      {children}
    </a>
  );
}

/** Launch-day announcement pill, in the same shape as the release-notes
 *  callout it replaces. This is bb's own markup rather than Product Hunt's
 *  embed, so it inherits the page's type and color and can ask for the vote
 *  outright. */
export function ProductHuntCallout({ placement }: { placement: CtaPlacement }) {
  return (
    <a
      className="updates-callout ph-callout"
      href={PRODUCT_HUNT_URL}
      target="_blank"
      rel="noreferrer"
      onClick={() =>
        trackLandingEvent({
          name: "landing_product_hunt_clicked",
          properties: { placement },
        })
      }
    >
      <span className="updates-label ph-callout-label">Today</span>
      <span className="updates-title">Vote for bb on Product Hunt</span>
      <HugeiconsIcon icon={ArrowRight01Icon} className="updates-arrow" />
    </a>
  );
}

/* ── Email signup ─────────────────────────────────────────────────── */

type SubscribeStatus = "idle" | "submitting" | "success" | "error";

// Email capture that POSTs to the first-party /api/subscribe Worker route,
// which adds the address to the bb marketing audience in Resend. JS-enhanced:
// it submits inline and swaps to a confirmation rather than navigating.
export function EmailSignup({ placement }: { placement: CtaPlacement }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<SubscribeStatus>("idle");
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status === "submitting") {
      return;
    }
    setStatus("submitting");
    setError("");
    try {
      const response = await fetch(SUBSCRIBE_PATH, {
        body: JSON.stringify({ email }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(body.error ?? "Something went wrong. Try again.");
        setStatus("error");
        return;
      }
      trackLandingEvent({
        name: "landing_email_subscribed",
        properties: { placement },
      });
      setStatus("success");
    } catch {
      setError("Could not reach the server. Try again.");
      setStatus("error");
    }
  };

  if (status === "success") {
    return (
      <p className="subscribe-done" role="status">
        <HugeiconsIcon
          icon={CheckmarkCircle02Icon}
          className="subscribe-done-ic"
        />
        You&rsquo;re on the list. We&rsquo;ll be in touch.
      </p>
    );
  }

  return (
    <form className="subscribe-form" onSubmit={submit} noValidate>
      <input
        className="subscribe-input"
        type="email"
        name="email"
        inputMode="email"
        autoComplete="email"
        required
        placeholder="you@example.com"
        aria-label="Email address"
        aria-invalid={status === "error"}
        value={email}
        onChange={(event) => {
          setEmail(event.target.value);
          if (status === "error") {
            setStatus("idle");
          }
        }}
      />
      <button
        type="submit"
        className="btn btn-primary subscribe-btn"
        disabled={status === "submitting"}
      >
        {status === "submitting" ? "Subscribing…" : "Subscribe"}
      </button>
      {status === "error" ? (
        <span className="subscribe-error" role="alert">
          {error}
        </span>
      ) : null}
    </form>
  );
}
