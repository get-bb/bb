import CheckmarkCircle02Icon from "@hugeicons/core-free-icons/CheckmarkCircle02Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState, type FormEvent } from "react";

import type { EmailLinkFailure } from "./analytics";
import { trackLandingEvent } from "./analytics";
import { EmailField } from "./cta";
import { SendToComputerButton } from "./send-to-computer-button";
import type { CtaPlacement } from "./site";
import { EMAIL_DOWNLOAD_LINK_PATH, isPlausibleEmail } from "./site";

type Status = "idle" | "invalid" | "sending" | "sent" | "failed";

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
    if (!isPlausibleEmail(email.trim())) {
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
        <span className="subscribe-error" role="alert">
          Couldn&rsquo;t send the email. Share the link instead.
        </span>
      </span>
    );
  }

  return (
    <EmailField
      hero
      className="touch-only"
      value={email}
      onChange={(value) => {
        setEmail(value);
        if (status === "invalid") {
          setStatus("idle");
        }
      }}
      onSubmit={(event) => void submit(event)}
      invalid={status === "invalid"}
      disabled={!ready || status === "sending"}
      placeholder="Your email"
      submitLabel={status === "sending" ? "Sending…" : "Send link"}
      error={status === "invalid" ? "Enter a valid email address." : null}
    />
  );
}
