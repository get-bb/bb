import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import AttachmentIcon from "@hugeicons/core-free-icons/AttachmentIcon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import Message01Icon from "@hugeicons/core-free-icons/Message01Icon";
import Mic02Icon from "@hugeicons/core-free-icons/Mic02Icon";
import MinusSignIcon from "@hugeicons/core-free-icons/MinusSignIcon";
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon";
import SentIcon from "@hugeicons/core-free-icons/SentIcon";
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import type { ReactNode } from "react";

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

function ThreadPill({
  title,
  agent,
}: {
  title: string;
  agent: "claude" | "codex";
}) {
  const Icon = agent === "claude" ? ClaudeIcon : OpenAiIcon;
  return (
    <span className="cmp-pill">
      <Icon className="cmp-pill-ic" />
      {title}
    </span>
  );
}

function PaneHead({
  icon,
  title,
  child,
}: {
  icon: ReactNode;
  title: string;
  child: boolean;
}) {
  return (
    <div className="cmp-pane-head">
      {icon}
      <span className="cmp-pane-title">{title}</span>
      {child ? <span className="cmp-pane-tag">child</span> : null}
    </div>
  );
}

export function AgentSplit() {
  return (
    <div
      className="cmp-split"
      role="img"
      aria-label="Two bb threads side by side: Claude Code starts a Codex thread to review its work, Codex sends its findings back, and Claude fixes them"
    >
      <section className="cmp-pane cmp-pane-focused">
        <PaneHead
          icon={<ClaudeIcon className="cmp-pane-ic" />}
          title="Add rate limiting to uploads"
          child={false}
        />
        <ol className="cmp-feed">
          <li className="cmp-user" style={{ animationDelay: "0.5s" }}>
            Add rate limiting to uploads. When you’re done, start a bb Codex
            thread to review it, then fix what it finds.
          </li>
          <li className="cmp-agent" style={{ animationDelay: "1s" }}>
            Added a token bucket in <code>upload.ts</code>. Starting a Codex
            review.
          </li>
          <li className="cmp-message" style={{ animationDelay: "3.6s" }}>
            <span className="cmp-message-head">
              <HugeiconsIcon icon={Message01Icon} className="cmp-message-ic" />
              <span className="cmp-message-label">Message from</span>
              <ThreadPill title="Review the rate limiter" agent="codex" />
            </span>
            <span className="cmp-message-body">
              Found 2 issues: the limiter keys on the socket IP, not
              X-Forwarded-For, and 429s have no Retry-After header.
            </span>
          </li>
          <li className="cmp-agent" style={{ animationDelay: "4.4s" }}>
            Fixed both. <code>pnpm test</code>{" "}
            <span className="cmp-ok">passes</span>.
          </li>
        </ol>
        <div className="cmp-composer">
          <span className="cmp-composer-head">
            <OpenAiIcon className="cmp-composer-ic" />
            Handoff to new thread
            <HugeiconsIcon icon={Cancel01Icon} className="cmp-composer-x" />
          </span>
          <span className="cmp-composer-input">
            Write release notes for{" "}
            <ThreadPill title="Add rate limiting to uploads" agent="claude" />
          </span>
          <span className="composer-row">
            <span className="model">
              <OpenAiIcon className="model-ic" />
              Codex
              <HugeiconsIcon icon={ArrowDown01Icon} className="chev-sm" />
            </span>
            <span className="composer-actions" aria-hidden="true">
              <HugeiconsIcon icon={AttachmentIcon} className="composer-clip" />
              <HugeiconsIcon icon={Mic02Icon} className="composer-clip" />
              <span className="send-btn">
                <HugeiconsIcon icon={SentIcon} className="send-ic" />
              </span>
            </span>
          </span>
        </div>
      </section>
      <section className="cmp-pane cmp-pane-child">
        <PaneHead
          icon={<OpenAiIcon className="cmp-pane-ic" />}
          title="Review the rate limiter"
          child
        />
        <ol className="cmp-feed">
          <li className="cmp-user" style={{ animationDelay: "1.8s" }}>
            Review the rate limiter on this branch, read-only. Report anything
            serious.
          </li>
          <li className="cmp-agent" style={{ animationDelay: "2.2s" }}>
            Reading <code>upload.ts</code> and its tests.
          </li>
          <li className="cmp-agent" style={{ animationDelay: "3s" }}>
            Found 2 issues. Sent them to{" "}
            <ThreadPill title="Add rate limiting to uploads" agent="claude" />.
          </li>
        </ol>
      </section>
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
