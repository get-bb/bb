import CheckmarkCircle02Icon from "@hugeicons/core-free-icons/CheckmarkCircle02Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState, type FormEvent } from "react";

import type { EmailLinkFailure } from "./analytics";
import { trackLandingEvent } from "./analytics";
import { SendToComputerButton } from "./send-to-computer-button";
import type { CtaPlacement } from "./site";
import { EMAIL_DOWNLOAD_LINK_PATH } from "./site";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

type Status = "idle" | "invalid" | "sending" | "sent" | "failed";

export function isPlausibleEmail(value: string): boolean {
  const email = value.trim();
  return email.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(email);
}

function failureReason(status: number): EmailLinkFailure {
  if (status === 400) {
    return "invalid_email";
  }
  return status === 503 ? "not_configured" : "send_failed";
}

export function EmailDownloadLinkForm({
  placement,
}: {
  placement: CtaPlacement;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const fail = (reason: EmailLinkFailure) => {
    trackLandingEvent({
      name: "landing_email_link_failed",
      properties: { placement, reason },
    });
    setStatus(reason === "invalid_email" ? "invalid" : "failed");
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status === "sending") {
      return;
    }
    if (!isPlausibleEmail(email)) {
      setStatus("invalid");
      return;
    }
    setStatus("sending");
    trackLandingEvent({
      name: "landing_email_link_submitted",
      properties: { placement },
    });
    let response: Response;
    try {
      response = await fetch(EMAIL_DOWNLOAD_LINK_PATH, {
        body: JSON.stringify({
          email: email.trim(),
          search: window.location.search,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
    } catch {
      fail("network");
      return;
    }
    if (!response.ok) {
      fail(failureReason(response.status));
      return;
    }
    trackLandingEvent({
      name: "landing_email_link_sent",
      properties: { placement },
    });
    setStatus("sent");
  };

  if (status === "sent") {
    return (
      <p className="install-email-done touch-only" role="status">
        <HugeiconsIcon icon={CheckmarkCircle02Icon} className="btn-ic" />
        Check your inbox on your computer
      </p>
    );
  }

  if (status === "failed") {
    return (
      <span className="install-email-failed touch-only">
        <SendToComputerButton placement={placement} />
        <span className="install-email-error" role="alert">
          Couldn&rsquo;t send the email. Share the link instead.
        </span>
      </span>
    );
  }

  return (
    <form
      className="install-email touch-only"
      method="post"
      onSubmit={(event) => void submit(event)}
      noValidate
    >
      <input
        className="install-email-input"
        type="email"
        name="email"
        inputMode="email"
        autoComplete="email"
        required
        placeholder="Your email"
        aria-label="Email address"
        aria-invalid={status === "invalid"}
        value={email}
        onChange={(event) => {
          setEmail(event.target.value);
          if (status === "invalid") {
            setStatus("idle");
          }
        }}
      />
      <button
        type="submit"
        className="btn btn-primary btn-install install-email-send"
        disabled={!ready || status === "sending"}
      >
        {status === "sending" ? "Sending…" : "Send link"}
      </button>
      {status === "invalid" ? (
        <span className="install-email-error" role="alert">
          Enter a valid email address.
        </span>
      ) : null}
    </form>
  );
}
