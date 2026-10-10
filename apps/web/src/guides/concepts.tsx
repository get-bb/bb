import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import ArrowTurnForwardIcon from "@hugeicons/core-free-icons/ArrowTurnForwardIcon";
import Calendar03Icon from "@hugeicons/core-free-icons/Calendar03Icon";
import CheckmarkCircle02Icon from "@hugeicons/core-free-icons/CheckmarkCircle02Icon";
import ComputerTerminal01Icon from "@hugeicons/core-free-icons/ComputerTerminal01Icon";
import Cursor01Icon from "@hugeicons/core-free-icons/Cursor01Icon";
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon";
import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon";
import LockIcon from "@hugeicons/core-free-icons/LockIcon";
import RefreshIcon from "@hugeicons/core-free-icons/RefreshIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import type { CSSProperties } from "react";

import conductorIcon from "../assets/competitors/conductor.png";
import cursorIcon from "../assets/competitors/cursor.png";
import supersetIcon from "../assets/competitors/superset.png";
import t3CodeIcon from "../assets/competitors/t3-code.png";
import vibeKanbanIcon from "../assets/competitors/vibe-kanban.png";
import { AnywhereVisual, BrandMark } from "../compare/compare-visuals";
import { ClaudeIcon, OpenAiIcon } from "../landing/icons";

const SERVERS = [
  { branch: "feat/checkout", port: 3001 },
  { branch: "fix/login", port: 3002 },
  { branch: "main", port: 3003 },
];

const MACHINE = "bb-worker-1";

function delay(index: number): CSSProperties {
  return { animationDelay: `${index * 1.1}s` };
}

export function RemoteServersConcept() {
  return (
    <div
      className="gd-diagram"
      role="img"
      aria-label="Three branches on one remote machine, each dev server shared at its own getbb.app link"
    >
      <div className="gd-card">
        <div className="gd-card-head">
          <span className="gd-card-title">
            <span className="gd-live" />
            {MACHINE}
          </span>
          <span className="gd-card-detail">Linux · always on</span>
        </div>
        {SERVERS.map((server) => (
          <div key={server.port} className="gd-row">
            <span className="gd-branch">
              <HugeiconsIcon icon={GitBranchIcon} className="gd-ic" />
              {server.branch}
            </span>
            <span className="gd-cmd">PORT={server.port} pnpm dev</span>
            <span className="gd-port">:{server.port}</span>
          </div>
        ))}
      </div>
      <div className="gd-wires" aria-hidden="true">
        {SERVERS.map((server, index) => (
          <span
            key={server.port}
            className="gd-wire"
            style={{ top: `${76 + index * 48}px`, ...delay(index) }}
          />
        ))}
      </div>
      <div className="gd-card">
        <div className="gd-card-head">
          <span className="gd-card-title">
            <span className="bb-mark" />
            Shared links
          </span>
          <span className="gd-lock">
            <HugeiconsIcon icon={LockIcon} className="gd-ic" />
            Your account only
          </span>
        </div>
        {SERVERS.map((server, index) => (
          <div
            key={server.port}
            className="gd-row gd-link"
            style={delay(index)}
          >
            <span className="gd-url">
              {MACHINE}--<b>{server.port}</b>.getbb.app
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AnywhereConcept() {
  return (
    <div className="gd-anywhere">
      <AnywhereVisual />
    </div>
  );
}

type SwitchFrom =
  | { id: string; name: string; src: string }
  | { id: string; name: string; glyph: typeof ClaudeIcon; tone: string };

const SWITCH_FROM: SwitchFrom[] = [
  {
    id: "claude",
    name: "Claude Code",
    glyph: ClaudeIcon,
    tone: "gd-switch-glyph-claude",
  },
  { id: "codex-app", name: "Codex", glyph: OpenAiIcon, tone: "" },
  { id: "conductor", name: "Conductor", src: conductorIcon },
  { id: "cursor", name: "Cursor", src: cursorIcon },
  { id: "superset", name: "Superset", src: supersetIcon },
  { id: "t3-code", name: "T3 Code", src: t3CodeIcon },
  { id: "vibe-kanban", name: "Vibe Kanban", src: vibeKanbanIcon },
];

export function SwitchConcept({ tool }: { tool: string }) {
  return (
    <div className="cmp-logos gd-switch">
      {SWITCH_FROM.filter((item) => item.id === tool).map((item) => (
        <span key={item.id} className="cmp-logo-item">
          {"glyph" in item ? (
            <span
              aria-hidden="true"
              className={`cmp-logo gd-switch-glyph ${item.tone}`}
            >
              <item.glyph className="gd-switch-glyph-ic" />
            </span>
          ) : (
            <BrandMark
              logo={{ kind: "image", src: item.src }}
              className="cmp-logo"
            />
          )}
          <span className="gd-switch-name">{item.name}</span>
        </span>
      ))}
      <HugeiconsIcon icon={ArrowRight01Icon} className="gd-switch-arrow" />
      <span className="cmp-logo-item">
        <BrandMark logo={{ kind: "bb" }} className="cmp-logo" />
        <span className="gd-switch-name">bb</span>
      </span>
    </div>
  );
}

export function ScheduleConcept() {
  return (
    <div
      className="gd-sched"
      role="img"
      aria-label="A script automation checks CI every 15 minutes. The 9:00 and 9:15 runs find nothing and are skipped. At 9:30 it finds a failed run and starts a Codex thread to fix it."
    >
      <div className="gd-card gd-sched-auto">
        <div className="gd-card-head">
          <span className="gd-card-title">
            <HugeiconsIcon
              icon={ComputerTerminal01Icon}
              className="gd-sched-ic"
            />
            CI failure check
          </span>
          <span className="gd-sched-toggle" />
        </div>
        <div className="gd-sched-meta">
          <HugeiconsIcon icon={Folder01Icon} className="gd-sched-ic" />
          acme-web
          <span aria-hidden="true">·</span>
          <HugeiconsIcon icon={Calendar03Icon} className="gd-sched-ic" />
          Every 15 min
        </div>
        <div className="gd-sched-label">Runs</div>
        {["9:00 AM", "9:15 AM"].map((time) => (
          <div key={time} className="gd-sched-run">
            <div className="gd-sched-run-head">
              <HugeiconsIcon
                icon={ArrowTurnForwardIcon}
                className="gd-sched-ic"
              />
              <span className="gd-sched-time">{time}</span>
              <span className="gd-sched-note">Skipped · empty output</span>
            </div>
          </div>
        ))}
        <div className="gd-sched-run">
          <div className="gd-sched-run-head">
            <span className="gd-sched-swap gd-sched-ic">
              <span className="gd-sched-before gd-sched-pending" />
              <span className="gd-sched-after">
                <HugeiconsIcon
                  icon={CheckmarkCircle02Icon}
                  className="gd-sched-ic gd-sched-ok"
                />
              </span>
            </span>
            <span className="gd-sched-time">9:30 AM</span>
            <span className="gd-sched-swap gd-sched-note">
              <span className="gd-sched-before">Running…</span>
              <span className="gd-sched-after">0.4s</span>
            </span>
          </div>
          <div className="gd-sched-output gd-sched-swap">
            <span className="gd-sched-before">
              Checking main for failed CI runs…
            </span>
            <span className="gd-sched-after">
              CI failed on main. Started a Codex thread.
            </span>
          </div>
        </div>
      </div>
      <div className="gd-sched-wire" aria-hidden="true">
        <span className="gd-sched-dot" />
      </div>
      <div className="gd-sched-swap gd-sched-thread-slot">
        <div className="gd-sched-before gd-sched-thread gd-sched-ghost">
          <div className="gd-sched-thread-title">No agent running</div>
          <div className="gd-sched-thread-status">
            Starts only when the script finds work
          </div>
        </div>
        <div className="gd-sched-after gd-card gd-sched-thread">
          <div className="gd-sched-thread-title">
            <OpenAiIcon className="gd-sched-ic" />
            Fix CI on main
          </div>
          <div className="gd-sched-thread-status">
            <span className="gd-live" />
            Reading the failed run…
          </div>
        </div>
      </div>
    </div>
  );
}

const BROWSER_SCENES = {
  code: {
    url: "localhost:3000/issues",
    label:
      "bb's Browser tab with Claude Code controlling a local app. The issue filter is pinned with the comment: Keep the filter visible on mobile.",
    title: "Issues",
    rows: [
      "Fix the mobile menu",
      "Add search to settings",
      "Keep filters after reload",
    ],
    target: "Open · 12",
    tag: "button",
    comment: "Keep the filter visible on mobile.",
  },
  work: {
    url: "billing.vendor.com/invoices",
    label:
      "bb's Browser tab with Claude Code controlling a signed-in billing site. The quarter's invoice total is pinned with the comment: Add this to the quarterly spend sheet.",
    title: "Invoices",
    rows: ["July · $1,240.00", "August · $1,315.50", "September · $1,402.75"],
    target: "Total · $3,958.25",
    tag: "td",
    comment: "Add this to the quarterly spend sheet.",
  },
};

export function BrowserConcept({ scene }: { scene: "code" | "work" }) {
  const view = BROWSER_SCENES[scene];
  return (
    <div className="gd-btab" role="img" aria-label={view.label}>
      <div className="gd-btab-tabs" aria-hidden="true">
        <span className="gd-btab-tab gd-btab-tab-on">Browser</span>
        <span className="gd-btab-tab">Diff</span>
        <span className="gd-btab-tab">Terminal</span>
      </div>
      <div className="gd-btab-bar" aria-hidden="true">
        <HugeiconsIcon icon={ArrowLeft01Icon} className="gd-btab-ic" />
        <HugeiconsIcon icon={ArrowRight01Icon} className="gd-btab-ic" />
        <HugeiconsIcon icon={RefreshIcon} className="gd-btab-ic" />
        <span className="gd-btab-url">{view.url}</span>
        <span className="gd-btab-annotate">
          <HugeiconsIcon icon={Cursor01Icon} className="gd-btab-ic" />
        </span>
      </div>
      <div className="gd-btab-control" aria-hidden="true">
        <span>Browser Automation is controlling this tab</span>
        <span className="gd-btab-action">Stop</span>
        <span className="gd-btab-action">Take over</span>
      </div>
      <div className="gd-btab-page" aria-hidden="true">
        <div className="gd-btab-page-head">
          <strong>{view.title}</strong>
          <span className="gd-btab-target">
            {view.target}
            <span className="gd-browser-pin gd-btab-pin">1</span>
          </span>
        </div>
        {view.rows.map((row) => (
          <div key={row} className="gd-btab-row">
            {row}
          </div>
        ))}
        <div className="gd-btab-note">
          <div className="gd-btab-note-target">
            <span className="gd-btab-tag">{view.tag}</span>
            {view.target}
          </div>
          <div className="gd-btab-note-text">{view.comment}</div>
          <div className="gd-btab-note-actions">
            <span className="gd-btab-action">Cancel</span>
            <span className="gd-btab-save">Add to prompt</span>
          </div>
        </div>
      </div>
    </div>
  );
}
