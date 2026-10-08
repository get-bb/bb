import CheckmarkCircle02Icon from "@hugeicons/core-free-icons/CheckmarkCircle02Icon";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { trackLandingEvent } from "./analytics";
import { LinuxIcon } from "./icons";
import type { CtaPlacement, DesktopPlatform } from "./site";
import {
  DESKTOP_DOWNLOADS,
  DISCORD_URL,
  GITHUB_URL,
  X_URL,
  SUBSCRIBE_PATH,
  downloadHref,
} from "./site";

type CtaLinkProps = {
  placement: CtaPlacement;
  className?: string;
  children: ReactNode;
};

export function DownloadLink({
  placement,
  platform,
  className,
  children,
}: CtaLinkProps & { platform: DesktopPlatform }) {
  return (
    <a className={className} href={downloadHref(platform, placement)}>
      {children}
    </a>
  );
}

const AppleSolidIcon: IconSvgElement = [
  [
    "path",
    {
      d: "M12 5.75C12 3.75 13.5 1.75 15.5 1.75C15.5 3.75 14 5.75 12 5.75Z",
      fill: "currentColor",
      key: "0",
    },
  ],
  [
    "path",
    {
      d: "M12.5 8.09001C11.9851 8.09001 11.5867 7.92646 11.1414 7.74368C10.5776 7.51225 9.93875 7.25 8.89334 7.25C7.02235 7.25 4 8.74945 4 12.7495C4 17.4016 7.10471 22.25 9.10471 22.25C9.77426 22.25 10.3775 21.9871 10.954 21.7359C11.4815 21.5059 11.9868 21.2857 12.5 21.2857C13.0132 21.2857 13.5185 21.5059 14.046 21.7359C14.6225 21.9871 15.2257 22.25 15.8953 22.25C17.2879 22.25 18.9573 19.8992 20 16.9008C18.3793 16.2202 17.338 14.618 17.338 12.75C17.338 11.121 18.2036 10.0398 19.5 9.25C18.5 7.75 17.0134 7.25 15.9447 7.25C14.8993 7.25 14.2604 7.51225 13.6966 7.74368C13.2514 7.92646 13.0149 8.09001 12.5 8.09001Z",
      fill: "currentColor",
      key: "1",
    },
  ],
];

function DesktopDownloadIcon({ platform }: { platform: DesktopPlatform }) {
  if (platform === "linux") {
    return <LinuxIcon className="btn-ic" />;
  }
  return <HugeiconsIcon icon={AppleSolidIcon} className="btn-ic" />;
}

export function DesktopDownloadButton({
  placement,
  platform,
  className,
}: {
  placement: CtaPlacement;
  platform: DesktopPlatform;
  className: string;
}) {
  return (
    <DownloadLink
      placement={placement}
      platform={platform}
      className={className}
    >
      <DesktopDownloadIcon platform={platform} />
      {DESKTOP_DOWNLOADS[platform].buttonLabel}
    </DownloadLink>
  );
}

function TrackedExternalLink({
  href,
  event,
  placement,
  className,
  children,
  "aria-label": ariaLabel,
}: CtaLinkProps & {
  href: string;
  event:
    | "landing_github_clicked"
    | "landing_discord_clicked"
    | "landing_x_clicked";
  "aria-label"?: string;
}) {
  return (
    <a
      className={className}
      aria-label={ariaLabel}
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={() =>
        trackLandingEvent({ name: event, properties: { placement } })
      }
    >
      {children}
    </a>
  );
}

export function GitHubLink(props: CtaLinkProps & { "aria-label"?: string }) {
  return (
    <TrackedExternalLink
      {...props}
      href={GITHUB_URL}
      event="landing_github_clicked"
    />
  );
}

export function DiscordLink(props: CtaLinkProps) {
  return (
    <TrackedExternalLink
      {...props}
      href={DISCORD_URL}
      event="landing_discord_clicked"
    />
  );
}

export function XLink(props: CtaLinkProps & { "aria-label"?: string }) {
  return (
    <TrackedExternalLink {...props} href={X_URL} event="landing_x_clicked" />
  );
}

type SubscribeStatus = "idle" | "submitting" | "success" | "error";

export const SUBSCRIBE_EMAIL_ID = "subscribe-email";

export function focusSubscribeEmail() {
  document.getElementById(SUBSCRIBE_EMAIL_ID)?.focus();
}

export function EmailSignup({ placement }: { placement: CtaPlacement }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<SubscribeStatus>("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    if (hash === SUBSCRIBE_EMAIL_ID || hash === "subscribe") {
      focusSubscribeEmail();
    }
  }, []);

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
        id={SUBSCRIBE_EMAIL_ID}
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

export function SubscribeSection({
  blurb,
  id,
  reveal,
}: {
  blurb: ReactNode;
  id?: string;
  reveal?: boolean;
}) {
  return (
    <section className="subscribe" id={id} data-reveal={reveal || undefined}>
      <h2 className="subscribe-title">Stay in the loop.</h2>
      <p>{blurb}</p>
      <EmailSignup placement="footer" />
    </section>
  );
}
