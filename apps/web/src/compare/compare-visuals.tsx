import MessageQuestionIcon from "@hugeicons/core-free-icons/MessageQuestionIcon";
import CheckmarkCircle02Icon from "@hugeicons/core-free-icons/CheckmarkCircle02Icon";
import Loading03Icon from "@hugeicons/core-free-icons/Loading03Icon";
import SidebarLeftIcon from "@hugeicons/core-free-icons/SidebarLeftIcon";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import ArrowMoveDownLeftIcon from "@hugeicons/core-free-icons/ArrowMoveDownLeftIcon";
import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import AttachmentIcon from "@hugeicons/core-free-icons/AttachmentIcon";
import BubbleChatAddIcon from "@hugeicons/core-free-icons/BubbleChatAddIcon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import Message01Icon from "@hugeicons/core-free-icons/Message01Icon";
import Mic02Icon from "@hugeicons/core-free-icons/Mic02Icon";
import MinusSignIcon from "@hugeicons/core-free-icons/MinusSignIcon";
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import type { ReactNode } from "react";

import { ClaudeIcon, CursorIcon, OpenAiIcon } from "../landing/icons";
import { useCycle } from "../landing/landing-visuals";

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
  icon: Icon,
}: {
  title: string;
  icon: typeof ClaudeIcon;
}) {
  return (
    <span className="cmp-pill">
      <Icon className="cmp-pill-ic" />
      {title}
    </span>
  );
}

function PaneHead({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="cmp-pane-head">
      {icon}
      <span className="cmp-pane-title">{title}</span>
    </div>
  );
}

function PhoneStatus({ status }: { status: "running" | "done" | "waiting" }) {
  return (
    <span className="tstatus" aria-hidden="true">
      {status === "running" ? (
        <HugeiconsIcon icon={Loading03Icon} className="trun" />
      ) : null}
      {status === "done" ? (
        <HugeiconsIcon icon={CheckmarkCircle02Icon} className="tdone" />
      ) : null}
      {status === "waiting" ? (
        <HugeiconsIcon icon={MessageQuestionIcon} className="twait" />
      ) : null}
    </span>
  );
}

const PROMPT = "Add rate limiting, then start a bb Codex review";

export function AgentSplit() {
  const { cycle, leaving } = useCycle(11500, 500);
  return (
    <div
      className="cmp-desktop"
      role="img"
      aria-label="The bb desktop app: you ask Claude Code for a change, it opens a Codex thread in a new split to review it, Codex sends its findings back, and Claude fixes them"
    >
      <div className="cmp-desktop-bar">
        <span className="cmp-desktop-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className="cmp-desktop-title">bb</span>
      </div>
      <div
        className={leaving ? "cmp-desktop-body leaving" : "cmp-desktop-body"}
        key={cycle}
      >
        <aside className="cmp-desktop-side">
          <div className="side-act">
            <HugeiconsIcon icon={BubbleChatAddIcon} className="sa-ic" />
            New thread
          </div>
          <div className="side-act">
            <HugeiconsIcon icon={Clock01Icon} className="sa-ic" />
            Automations
          </div>
          <div className="side-label">All Threads</div>
          <ul className="threads">
            <li>
              <span className="trow active">
                <span className="trow-title">Add rate limiting to uploads</span>
                <PhoneStatus status="running" />
              </span>
              <ul
                className="threads thread-kids cmp-anim-in"
                style={{ animationDelay: "3.4s" }}
              >
                <li className="kid-li">
                  <span className="trow trow-kid">
                    <span className="trow-title">Review the rate limiter</span>
                    <PhoneStatus status="running" />
                  </span>
                </li>
              </ul>
            </li>
            <li>
              <span className="trow">
                <span className="trow-title">Triage new issues</span>
                <PhoneStatus status="done" />
              </span>
            </li>
            <li>
              <span className="trow">
                <span className="trow-title">Add a dark mode toggle</span>
                <PhoneStatus status="waiting" />
              </span>
            </li>
          </ul>
        </aside>
        <div className="cmp-split">
          <section className="cmp-pane cmp-pane-focused">
            <PaneHead
              icon={<ClaudeIcon className="cmp-pane-ic" />}
              title="Add rate limiting to uploads"
            />
            <ol className="cmp-feed">
              <li className="cmp-user" style={{ animationDelay: "2.3s" }}>
                {PROMPT}
              </li>
              <li className="cmp-agent" style={{ animationDelay: "2.9s" }}>
                Added a token bucket in <code>upload.ts</code>. Starting a Codex
                review.
              </li>
              <li className="cmp-message" style={{ animationDelay: "6s" }}>
                <span className="cmp-message-head">
                  <HugeiconsIcon
                    icon={Message01Icon}
                    className="cmp-message-ic"
                  />
                  <span className="cmp-message-label">Message from</span>
                  <ThreadPill
                    title="Review the rate limiter"
                    icon={OpenAiIcon}
                  />
                </span>
                <span className="cmp-message-body">
                  Found 2 issues: the limiter keys on the socket IP, not
                  X-Forwarded-For, and 429s have no Retry-After header.
                </span>
              </li>
              <li className="cmp-agent" style={{ animationDelay: "6.7s" }}>
                Fixed both. <code>pnpm test</code>{" "}
                <span className="cmp-ok">passes</span>.
              </li>
            </ol>
            <div className="cmp-compose-stack">
              <div className="cmp-composer cmp-compose-prompt">
                <span className="cmp-composer-input cmp-input-stack">
                  <span className="cmp-type">{PROMPT}</span>
                  <span className="cmp-composer-placeholder cmp-input-after-send">
                    Ask a follow-up
                  </span>
                </span>
                <span className="composer-row">
                  <span className="model">
                    <ClaudeIcon className="model-ic" />
                    Claude Code
                    <HugeiconsIcon icon={ArrowDown01Icon} className="chev-sm" />
                  </span>
                  <span className="composer-actions" aria-hidden="true">
                    <HugeiconsIcon
                      icon={AttachmentIcon}
                      className="composer-clip"
                    />
                    <HugeiconsIcon icon={Mic02Icon} className="composer-clip" />
                    <span className="send-btn cmp-send-pulse">
                      <HugeiconsIcon
                        icon={ArrowMoveDownLeftIcon}
                        className="send-ic"
                      />
                    </span>
                  </span>
                </span>
              </div>
              <div className="cmp-composer cmp-compose-handoff">
                <span className="cmp-composer-head">
                  <HugeiconsIcon
                    icon={BubbleChatAddIcon}
                    className="cmp-composer-ic"
                  />
                  Handoff to new thread
                  <HugeiconsIcon
                    icon={Cancel01Icon}
                    className="cmp-composer-x"
                  />
                </span>
                <span className="cmp-composer-input">
                  Write release notes for{" "}
                  <ThreadPill
                    title="Add rate limiting to uploads"
                    icon={ClaudeIcon}
                  />
                </span>
                <span className="composer-row">
                  <span className="model">
                    <CursorIcon className="model-ic" />
                    Cursor
                    <HugeiconsIcon icon={ArrowDown01Icon} className="chev-sm" />
                  </span>
                  <span className="composer-actions" aria-hidden="true">
                    <HugeiconsIcon
                      icon={AttachmentIcon}
                      className="composer-clip"
                    />
                    <HugeiconsIcon icon={Mic02Icon} className="composer-clip" />
                    <span className="send-btn">
                      <HugeiconsIcon
                        icon={ArrowMoveDownLeftIcon}
                        className="send-ic"
                      />
                    </span>
                  </span>
                </span>
              </div>
            </div>
          </section>
          <section className="cmp-pane cmp-pane-child">
            <div className="cmp-pane-inner">
              <PaneHead
                icon={<OpenAiIcon className="cmp-pane-ic" />}
                title="Review the rate limiter"
              />
              <ol className="cmp-feed">
                <li className="cmp-user" style={{ animationDelay: "4s" }}>
                  Review the rate limiter on this branch, read-only. Report
                  anything serious.
                </li>
                <li className="cmp-agent" style={{ animationDelay: "4.6s" }}>
                  Reading <code>upload.ts</code> and its tests.
                </li>
                <li className="cmp-agent" style={{ animationDelay: "5.4s" }}>
                  Found 2 issues. Sent them to{" "}
                  <ThreadPill
                    title="Add rate limiting to uploads"
                    icon={ClaudeIcon}
                  />
                  .
                </li>
              </ol>
              <div className="cmp-composer">
                <span className="cmp-composer-input cmp-composer-placeholder">
                  Ask a follow-up
                </span>
                <span className="composer-row">
                  <span className="model">
                    <OpenAiIcon className="model-ic" />
                    Codex
                    <HugeiconsIcon icon={ArrowDown01Icon} className="chev-sm" />
                  </span>
                  <span className="composer-actions" aria-hidden="true">
                    <HugeiconsIcon
                      icon={AttachmentIcon}
                      className="composer-clip"
                    />
                    <HugeiconsIcon icon={Mic02Icon} className="composer-clip" />
                    <span className="send-btn">
                      <HugeiconsIcon
                        icon={ArrowMoveDownLeftIcon}
                        className="send-ic"
                      />
                    </span>
                  </span>
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

const MACHINES = [
  { name: "MacBook Air", detail: "This computer", threads: 3 },
  { name: "Mac mini", detail: "Always on, at home", threads: 5 },
  { name: "Cloud server", detail: "Linux", threads: 2 },
] as const;

function MachinesCard() {
  return (
    <div className="cmp-machines" aria-hidden="true">
      <span className="cmp-machines-title">Machines</span>
      <span className="cmp-machines-list">
        <span className="cmp-flow">
          <span className="cmp-flow-packet" />
          <span className="cmp-flow-packet cmp-flow-packet-up" />
        </span>
        {MACHINES.map((machine, index) => (
          <span key={machine.name} className="cmp-machine">
            <span
              className="cmp-machine-dot"
              style={{ animationDelay: `${index * 1.1}s` }}
            />
            <span className="cmp-machine-body">
              <span className="cmp-machine-name">{machine.name}</span>
              <span className="cmp-machine-detail">{machine.detail}</span>
            </span>
            <span className="cmp-machine-count">{machine.threads} running</span>
          </span>
        ))}
      </span>
    </div>
  );
}

export function AnywhereVisual() {
  return (
    <div className="cmp-anywhere">
      <PhoneApp />
      <MachinesCard />
    </div>
  );
}

function PhoneApp() {
  return (
    <div
      className="cmp-phone"
      role="img"
      aria-label="bb on a phone: a push notification over the threads list, with running, finished, and waiting threads"
    >
      <div className="cmp-phone-screen">
        <div className="cmp-status" aria-hidden="true">
          <span>9:41</span>
          <span className="cmp-status-icons">
            <span className="cmp-signal">
              <span />
              <span />
              <span />
              <span />
            </span>
            <span className="cmp-battery" />
          </span>
        </div>
        <span className="cmp-island" aria-hidden="true" />
        <div className="cmp-push">
          <span aria-hidden="true" className="bb-mark cmp-push-mark" />
          <span className="cmp-push-body">
            <span className="cmp-push-title">Review the rate limiter</span>
            <span className="cmp-push-text">Finished and waiting for you</span>
          </span>
          <span className="cmp-push-time">now</span>
        </div>
        <div className="cmp-app-bar">
          <HugeiconsIcon icon={SidebarLeftIcon} className="cmp-app-ic" />
          <span className="cmp-app-title">Threads</span>
          <HugeiconsIcon icon={BubbleChatAddIcon} className="cmp-app-ic" />
        </div>
        <div className="cmp-phone-side">
          <div className="side-act">
            <HugeiconsIcon icon={BubbleChatAddIcon} className="sa-ic" />
            New thread
          </div>
          <div className="side-act">
            <HugeiconsIcon icon={Clock01Icon} className="sa-ic" />
            Automations
          </div>
          <div className="side-label">All Threads</div>
          <ul className="threads">
            <li>
              <span className="trow active">
                <span className="trow-title">Add rate limiting to uploads</span>
                <PhoneStatus status="running" />
              </span>
              <ul className="threads thread-kids">
                <li className="kid-li">
                  <span className="trow trow-kid">
                    <span className="trow-title">Review the rate limiter</span>
                    <PhoneStatus status="done" />
                  </span>
                </li>
                <li className="kid-li">
                  <span className="trow trow-kid">
                    <span className="trow-title">Write release notes</span>
                    <PhoneStatus status="waiting" />
                  </span>
                </li>
              </ul>
            </li>
            <li>
              <span className="trow">
                <span className="trow-title">Triage new issues</span>
                <PhoneStatus status="done" />
              </span>
            </li>
            <li>
              <span className="trow">
                <span className="trow-title">Add a dark mode toggle</span>
                <PhoneStatus status="running" />
              </span>
            </li>
          </ul>
        </div>
        <div className="cmp-phone-composer">
          <span className="cmp-phone-input">Ask anything…</span>
          <span className="send-btn">
            <HugeiconsIcon icon={ArrowMoveDownLeftIcon} className="send-ic" />
          </span>
        </div>
        <span className="cmp-home" aria-hidden="true" />
      </div>
    </div>
  );
}

const MAX_SEATS = 10;

export function TeamCost({
  plan,
  logo,
  yearlyPerSeatMonthly,
}: {
  plan: string;
  logo: BrandLogo;
  yearlyPerSeatMonthly: number;
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
      <p className="cmp-cost-foot">
        {plan} at ${yearlyPerSeatMonthly} per user a month. Your agent plans are
        separate either way.
      </p>
    </div>
  );
}
