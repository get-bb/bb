import MinusSignIcon from "@hugeicons/core-free-icons/MinusSignIcon";
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon";
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

import { ClaudeIcon, OpenAiIcon } from "../landing/icons";

export type BrandLogo = { kind: "bb" } | { kind: "image"; src: string };

export function BrandMark({
  logo,
  className,
}: {
  logo: BrandLogo;
  className: string;
}) {
  if (logo.kind === "bb") {
    return <span aria-hidden="true" className={`bb-mark ${className}`} />;
  }
  return <img src={logo.src} alt="" className={className} />;
}

export function HandoffThread() {
  return (
    <div
      className="cmp-handoff"
      role="img"
      aria-label="A bb thread where Claude Code starts a Codex review thread, waits for its findings, and fixes them"
    >
      <div className="cmp-ho-bar">
        <span aria-hidden="true" className="bb-mark cmp-ho-mark" />
        <span className="cmp-ho-title">Add rate limiting to uploads</span>
        <code className="cmp-ho-branch">bb/rate-limit-uploads</code>
      </div>
      <ol className="cmp-ho-feed">
        <li className="cmp-ho-user" style={{ animationDelay: "0.6s" }}>
          Add rate limiting to uploads, then have Codex review it.
        </li>
        <li className="cmp-ho-say" style={{ animationDelay: "1.1s" }}>
          <ClaudeIcon className="cmp-ho-ic" />
          <span>
            Added a token bucket in <code>upload.ts</code>. Starting a Codex
            review.
          </span>
        </li>
        <li className="cmp-ho-child" style={{ animationDelay: "1.8s" }}>
          <OpenAiIcon className="cmp-ho-ic" />
          <span className="cmp-ho-child-body">
            <span className="cmp-ho-child-name">Codex</span>
            <span className="cmp-ho-child-task">Review the rate limiter</span>
          </span>
          <span className="cmp-ho-stat" aria-hidden="true">
            <span className="cmp-ho-run">
              <span className="cmp-ho-dot" />
              running
            </span>
            <span className="cmp-ho-done">
              <HugeiconsIcon icon={Tick02Icon} className="cmp-ho-check" />2
              findings
            </span>
          </span>
          <ul className="cmp-ho-findings">
            <li>Limiter keys on socket IP, not X-Forwarded-For</li>
            <li>429 responses have no Retry-After header</li>
          </ul>
        </li>
        <li className="cmp-ho-say" style={{ animationDelay: "4.1s" }}>
          <ClaudeIcon className="cmp-ho-ic" />
          <span>
            Fixed both. <code>pnpm test</code>{" "}
            <span className="cmp-ho-ok">passes</span>.
          </span>
        </li>
      </ol>
    </div>
  );
}

export function PhoneApproval() {
  return (
    <div
      className="cmp-phone"
      role="img"
      aria-label="A push notification on a phone, and the thread open to approve a command"
    >
      <div className="cmp-push">
        <span aria-hidden="true" className="bb-mark cmp-push-mark" />
        <span className="cmp-push-body">
          <span className="cmp-push-title">Add rate limiting to uploads</span>
          <span className="cmp-push-text">Approve command: pnpm test</span>
        </span>
        <span className="cmp-push-time">now</span>
      </div>
      <div className="cmp-screen">
        <div className="cmp-thread cmp-thread-waiting">
          <ClaudeIcon className="cmp-prov" />
          <span className="cmp-thread-title">Add rate limiting to uploads</span>
          <span className="cmp-thread-dot" />
        </div>
        <div className="cmp-thread cmp-thread-child">
          <OpenAiIcon className="cmp-prov" />
          <span className="cmp-thread-title">Review the rate limiter</span>
          <span className="cmp-thread-done">done</span>
        </div>
        <div className="cmp-approval">
          <span className="cmp-approval-label">Approval needed</span>
          <code className="cmp-approval-cmd">pnpm test</code>
          <div className="cmp-approval-actions">
            <span className="cmp-chip cmp-chip-primary">Allow once</span>
            <span className="cmp-chip">Deny</span>
            <span className="cmp-chip">Allow for session</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const MAX_SEATS = 10;

export function TeamCost({
  plan,
  logo,
  yearlyPerSeatMonthly,
  included,
}: {
  plan: string;
  logo: BrandLogo;
  yearlyPerSeatMonthly: number;
  included: string[];
}) {
  const [seats, setSeats] = useState(5);
  const total = seats * yearlyPerSeatMonthly * 12;
  return (
    <div className="cmp-cost">
      <div className="cmp-cost-head">
        <span className="cmp-cost-label">Per year</span>
        <div className="cmp-seats" role="group" aria-label="Team size">
          <button
            type="button"
            aria-label="Remove a person"
            disabled={seats <= 1}
            onClick={() => setSeats((n) => Math.max(1, n - 1))}
          >
            <HugeiconsIcon icon={MinusSignIcon} />
          </button>
          <output aria-live="polite">
            {seats} {seats === 1 ? "person" : "people"}
          </output>
          <button
            type="button"
            aria-label="Add a person"
            disabled={seats >= MAX_SEATS}
            onClick={() => setSeats((n) => Math.min(MAX_SEATS, n + 1))}
          >
            <HugeiconsIcon icon={PlusSignIcon} />
          </button>
        </div>
      </div>
      <div className="cmp-cost-row">
        <BrandMark logo={logo} className="cmp-cost-logo" />
        <span className="cmp-cost-who">
          <span className="cmp-cost-name">{plan}</span>
          <span className="cmp-cost-math">
            {seats} × ${yearlyPerSeatMonthly} × 12 months
          </span>
        </span>
        <span className="cmp-cost-total">${total.toLocaleString("en-US")}</span>
        <span className="cmp-cost-bar">
          <span
            className="cmp-cost-fill"
            style={{ inlineSize: `${(seats / MAX_SEATS) * 100}%` }}
          />
        </span>
      </div>
      <div className="cmp-cost-row">
        <BrandMark logo={{ kind: "bb" }} className="cmp-cost-logo" />
        <span className="cmp-cost-who">
          <span className="cmp-cost-name">bb</span>
          <span className="cmp-cost-math">Any team size</span>
        </span>
        <span className="cmp-cost-total">$0</span>
        <span className="cmp-cost-bar">
          <span className="cmp-cost-fill cmp-cost-fill-bb" />
        </span>
      </div>
      <ul className="cmp-cost-incl" aria-label="Included in bb">
        {included.map((item) => (
          <li key={item}>
            <HugeiconsIcon icon={Tick02Icon} className="cmp-cost-check" />
            {item}
          </li>
        ))}
      </ul>
      <p className="cmp-cost-foot">
        {plan} at ${yearlyPerSeatMonthly}/user/mo billed yearly. Your Claude or
        Codex plan is separate either way.
      </p>
    </div>
  );
}
