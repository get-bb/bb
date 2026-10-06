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
import FilterHorizontalIcon from "@hugeicons/core-free-icons/FilterHorizontalIcon";
import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon";
import KanbanIcon from "@hugeicons/core-free-icons/KanbanIcon";
import AppleIcon from "@hugeicons/core-free-icons/AppleIcon";
import SmartPhone01Icon from "@hugeicons/core-free-icons/SmartPhone01Icon";
import WindowsNewIcon from "@hugeicons/core-free-icons/WindowsNewIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import type { ReactNode } from "react";

import {
  ClaudeIcon,
  CursorIcon,
  LinuxIcon,
  OpenAiIcon,
} from "../landing/icons";
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

type FleetThread = {
  title: string;
  agent: typeof ClaudeIcon;
  status: "running" | "done" | "waiting";
};

const FLEET: {
  name: string;
  os: string;
  icon: ReactNode;
  threads: FleetThread[];
}[] = [
  {
    name: "MacBook Pro",
    os: "macOS",
    icon: <HugeiconsIcon icon={AppleIcon} className="cmp-fleet-os-ic" />,
    threads: [
      { title: "Rate-limit uploads", agent: ClaudeIcon, status: "running" },
      { title: "Review the limiter", agent: OpenAiIcon, status: "done" },
      { title: "Write release notes", agent: CursorIcon, status: "waiting" },
    ],
  },
  {
    name: "Desktop PC",
    os: "Windows",
    icon: <HugeiconsIcon icon={WindowsNewIcon} className="cmp-fleet-os-ic" />,
    threads: [
      { title: "Fix the flaky test", agent: CursorIcon, status: "running" },
      { title: "Add dark mode", agent: ClaudeIcon, status: "running" },
      { title: "Update the docs", agent: OpenAiIcon, status: "done" },
    ],
  },
  {
    name: "Cloud server",
    os: "Linux",
    icon: <LinuxIcon className="cmp-fleet-os-ic" />,
    threads: [
      { title: "Bump packages", agent: OpenAiIcon, status: "running" },
      { title: "Triage new issues", agent: ClaudeIcon, status: "done" },
      { title: "Nightly test sweep", agent: ClaudeIcon, status: "running" },
    ],
  },
  {
    name: "Mobile",
    os: "iOS & Android",
    icon: <HugeiconsIcon icon={SmartPhone01Icon} className="cmp-fleet-os-ic" />,
    threads: [
      { title: "Nightly test sweep", agent: ClaudeIcon, status: "running" },
      { title: "Rate-limit uploads", agent: ClaudeIcon, status: "running" },
      { title: "Fix the flaky test", agent: CursorIcon, status: "running" },
    ],
  },
];

export function FleetVisual() {
  return (
    <div
      className="cmp-fleet"
      role="img"
      aria-label="One bb running Claude Code, Codex, and Cursor threads on a MacBook, a Windows PC at home, and an always-on Linux server, with every thread on your phone"
    >
      <div className="cmp-fleet-machines">
        {FLEET.map((machine, index) => (
          <div key={machine.name} className="cmp-fleet-card">
            <span className="cmp-fleet-head">
              <span className="cmp-fleet-os">{machine.icon}</span>
              <span className="cmp-fleet-who">
                <span className="cmp-fleet-name">{machine.name}</span>
                <span className="cmp-fleet-detail">{machine.os}</span>
              </span>
              <span
                className="cmp-machine-dot"
                style={{ animationDelay: `${index * 1.1}s` }}
              />
            </span>
            <ul className="cmp-fleet-threads">
              {machine.threads.map((thread) => (
                <li key={thread.title} className="cmp-fleet-thread">
                  <thread.agent className="cmp-fleet-agent" />
                  <span className="trow-title">{thread.title}</span>
                  <PhoneStatus status={thread.status} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
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

type TaskStatus = "backlog" | "todo" | "progress" | "review";

const STATUS_NAMES: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  progress: "In Progress",
  review: "In Review",
};

function StatusGlyph({ status }: { status: TaskStatus }) {
  return (
    <svg
      viewBox="0 0 14 14"
      className={`cmp-tasks-status cmp-tasks-status-${status}`}
      aria-hidden="true"
    >
      <circle
        cx="7"
        cy="7"
        r="5.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeDasharray={status === "backlog" ? "1.8 2" : undefined}
      />
      {status === "progress" ? (
        <path d="M7 3.4 A3.6 3.6 0 0 1 7 10.6 Z" fill="currentColor" />
      ) : null}
      {status === "review" ? (
        <path d="M7 3.4 A3.6 3.6 0 1 1 3.4 7 L7 7 Z" fill="currentColor" />
      ) : null}
    </svg>
  );
}

function PriorityBars({ level }: { level: 1 | 2 | 3 }) {
  return (
    <svg viewBox="0 0 12 12" className="cmp-tasks-priority" aria-hidden="true">
      {[0, 1, 2].map((bar) => (
        <rect
          key={bar}
          x={1 + bar * 3.6}
          y={8 - bar * 2.6}
          width="2.4"
          height={3 + bar * 2.6}
          rx="0.6"
          className={bar < level ? "on" : undefined}
        />
      ))}
    </svg>
  );
}

type TaskLabel = { name: string; tone: "accent" | "ok" | "spark" | "del" };

function TaskCard({
  id,
  title,
  agent,
  priority,
  labels,
  subtasks,
  className,
}: {
  id: string;
  title: string;
  agent: string | null;
  priority: 1 | 2 | 3;
  labels: TaskLabel[];
  subtasks: string | null;
  className?: string;
}) {
  return (
    <div
      className={className ? `cmp-tasks-card ${className}` : "cmp-tasks-card"}
    >
      <span className="cmp-tasks-card-top">
        <span className="cmp-tasks-key">{id}</span>
        {agent ? (
          <span className="cmp-tasks-agent">
            <span className="cmp-tasks-agent-dot" />
            {agent}
          </span>
        ) : null}
      </span>
      <span className="cmp-tasks-title">{title}</span>
      <span className="cmp-tasks-meta">
        <PriorityBars level={priority} />
        {labels.map((label) => (
          <span key={label.name} className="cmp-tasks-label">
            <span className={`cmp-tasks-label-dot ${label.tone}`} />
            {label.name}
          </span>
        ))}
        {subtasks ? (
          <span className="cmp-tasks-sub">
            <HugeiconsIcon icon={GitBranchIcon} className="cmp-tasks-sub-ic" />
            {subtasks}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function TaskColumn({
  status,
  count,
  nextCount,
  children,
}: {
  status: TaskStatus;
  count: number;
  nextCount: number;
  children: ReactNode;
}) {
  return (
    <div className="cmp-tasks-col">
      <span className="cmp-tasks-col-head">
        <StatusGlyph status={status} />
        {STATUS_NAMES[status]}
        <span className="cmp-tasks-count">
          {count === nextCount ? (
            count
          ) : (
            <>
              <span className="cmp-tasks-count-before">{count}</span>
              <span className="cmp-tasks-count-after">{nextCount}</span>
            </>
          )}
        </span>
        <HugeiconsIcon icon={PlusSignIcon} className="cmp-tasks-col-add" />
      </span>
      {children}
    </div>
  );
}

function DelegateMenu() {
  return (
    <span className="cmp-tasks-menu" aria-hidden="true">
      <span className="cmp-tasks-menu-label">Delegate to</span>
      <span className="cmp-tasks-menu-item">
        <ClaudeIcon className="cmp-tasks-menu-ic" />
        Claude Code
      </span>
      <span className="cmp-tasks-menu-item cmp-tasks-menu-pick">
        <OpenAiIcon className="cmp-tasks-menu-ic" />
        Codex
      </span>
      <span className="cmp-tasks-menu-item">
        <CursorIcon className="cmp-tasks-menu-ic" />
        Cursor
      </span>
    </span>
  );
}

const API: TaskLabel = { name: "api", tone: "accent" };
const BUG: TaskLabel = { name: "bug", tone: "del" };
const UI: TaskLabel = { name: "ui", tone: "spark" };
const INFRA: TaskLabel = { name: "infra", tone: "ok" };

export function TasksBoard({ compact }: { compact: boolean }) {
  const { cycle, leaving } = useCycle(9000, 500);
  return (
    <div
      className={compact ? "cmp-tasks cmp-tasks-compact" : "cmp-tasks"}
      role="img"
      aria-label={
        compact
          ? "The bb Tasks board: a task in Todo is delegated to Codex and moves to In Progress, next to a task Claude Code is working on"
          : "The bb Tasks board: a task in Todo is delegated to Codex and moves to In Progress, next to a task Claude Code is working on and one waiting in review"
      }
    >
      <div className="cmp-tasks-bar">
        <span className="cmp-tasks-project">
          <HugeiconsIcon icon={KanbanIcon} className="cmp-tasks-project-ic" />
          Website
          <span className="cmp-tasks-prefix">APP</span>
        </span>
        <span className="cmp-tasks-views" aria-hidden="true">
          <span>List</span>
          <span className="on">Board</span>
        </span>
        <span className="cmp-tasks-tools" aria-hidden="true">
          <span className="cmp-tasks-tool">
            <HugeiconsIcon
              icon={FilterHorizontalIcon}
              className="cmp-tasks-tool-ic"
            />
            Filter
          </span>
          <span className="cmp-tasks-new">
            <HugeiconsIcon icon={PlusSignIcon} className="cmp-tasks-tool-ic" />
            New task
          </span>
        </span>
      </div>
      <div
        className={leaving ? "cmp-tasks-board leaving" : "cmp-tasks-board"}
        key={cycle}
      >
        {compact ? null : (
          <TaskColumn status="backlog" count={2} nextCount={2}>
            <TaskCard
              id="APP-18"
              title="Move settings to the new store"
              agent={null}
              priority={1}
              labels={[INFRA]}
              subtasks={null}
            />
            <TaskCard
              id="APP-19"
              title="Keyboard shortcuts for the board"
              agent={null}
              priority={1}
              labels={[UI]}
              subtasks={null}
            />
          </TaskColumn>
        )}
        <TaskColumn status="todo" count={2} nextCount={1}>
          <TaskCard
            id="APP-14"
            title="Add CSV export to reports"
            agent={null}
            priority={3}
            labels={[API]}
            subtasks="0/2"
            className="cmp-tasks-leave"
          />
          <TaskCard
            id="APP-15"
            title="Fix the flaky upload test"
            agent={null}
            priority={2}
            labels={[BUG]}
            subtasks={null}
          />
          <DelegateMenu />
        </TaskColumn>
        <TaskColumn status="progress" count={1} nextCount={2}>
          <TaskCard
            id="APP-12"
            title="Add rate limiting to uploads"
            agent="Claude Code"
            priority={3}
            labels={[API]}
            subtasks="2/3"
          />
          <TaskCard
            id="APP-14"
            title="Add CSV export to reports"
            agent="Codex"
            priority={3}
            labels={[API]}
            subtasks="0/2"
            className="cmp-tasks-arrive"
          />
        </TaskColumn>
        {compact ? null : (
          <TaskColumn status="review" count={1} nextCount={1}>
            <TaskCard
              id="APP-9"
              title="Add a dark mode toggle"
              agent={null}
              priority={2}
              labels={[UI]}
              subtasks="3/3"
            />
          </TaskColumn>
        )}
      </div>
    </div>
  );
}

function LedgerThread({
  icon,
  title,
  preset,
}: {
  icon: ReactNode;
  title: string;
  preset: string;
}) {
  return (
    <li className="cmp-ledger-thread">
      {icon}
      <span className="cmp-ledger-agent">
        {title}
        <span className="cmp-ledger-preset">{preset}</span>
      </span>
      <span className="cmp-ledger-state">
        <HugeiconsIcon
          icon={CheckmarkCircle02Icon}
          className="cmp-ledger-state-ic"
        />
        Done
      </span>
    </li>
  );
}

export function TaskLedger() {
  return (
    <div
      className="cmp-ledger"
      role="img"
      aria-label="A bb task in review with the Claude Code and Codex threads that worked on it, and Claude Code's comment saying the work is ready"
    >
      <div className="cmp-ledger-head">
        <span className="cmp-ledger-status">
          <StatusGlyph status="review" />
          In Review
        </span>
        <span className="cmp-tasks-key">APP-12</span>
      </div>
      <h3 className="cmp-ledger-title">Add rate limiting to uploads</h3>
      <ul className="cmp-ledger-threads">
        <LedgerThread
          icon={<ClaudeIcon className="cmp-ledger-ic" />}
          title="Add rate limiting to uploads"
          preset="Claude Code"
        />
        <LedgerThread
          icon={<OpenAiIcon className="cmp-ledger-ic" />}
          title="Review the rate limiter"
          preset="Codex"
        />
      </ul>
      <div className="cmp-ledger-comment">
        <span className="cmp-ledger-comment-head">
          <ClaudeIcon className="cmp-ledger-ic" />
          Claude Code
        </span>
        <p>
          Added per-user limits with tests. Codex reviewed them and its two
          fixes are in. Ready for you.
        </p>
      </div>
    </div>
  );
}

export function TeamCost({
  plan,
  logo,
  yearlyPerSeatMonthly,
  priceNote,
}: {
  plan: string;
  logo: BrandLogo;
  yearlyPerSeatMonthly: number;
  priceNote: string;
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
        {priceNote} Your agent plans are separate either way.
      </p>
    </div>
  );
}
