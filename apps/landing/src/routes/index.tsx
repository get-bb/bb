import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import { trackLandingEvent } from "../analytics";
import type { CtaPlacement } from "../analytics";
import { CLI_COMMAND, DOWNLOAD_MACOS_URL, GITHUB_URL } from "../site";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

type CtaLinkProps = {
  placement: CtaPlacement;
  /** Omit for a plain inline link (nav/footer); set for button-styled CTAs. */
  className?: string;
  children: ReactNode;
};

function DownloadLink({ placement, className, children }: CtaLinkProps) {
  return (
    <a
      className={className}
      href={DOWNLOAD_MACOS_URL}
      onClick={() =>
        trackLandingEvent({
          name: "landing_download_macos_clicked",
          properties: { placement },
        })
      }
    >
      {children}
    </a>
  );
}

function GitHubLink({ placement, className, children }: CtaLinkProps) {
  return (
    <a
      className={className}
      href={GITHUB_URL}
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

type InstallCommandProps = {
  placement: CtaPlacement;
};

function InstallCommand({ placement }: InstallCommandProps) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(CLI_COMMAND);
    trackLandingEvent({
      name: "landing_cli_command_copied",
      properties: { placement, command: CLI_COMMAND },
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="install mono">
      <span className="dollar">$</span>
      <span>{CLI_COMMAND}</span>
      <button type="button" onClick={() => void copy()}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function LandingPage() {
  return (
    <div className="wrap">
      <nav className="nav">
        <a className="logo" href="/">
          bb<span>.</span>
        </a>
        <div className="nav-links">
          <GitHubLink placement="nav">GitHub</GitHubLink>
          <DownloadLink placement="nav" className="btn btn-primary btn-sm">
            Download for macOS
          </DownloadLink>
        </div>
      </nav>

      <header className="hero">
        <span className="kicker">Open source · local-first</span>
        <h1>The IDE agents can use themselves.</h1>
        <p className="sub">
          bb runs Claude Code, Codex, and Pi as threads you can watch and
          steer — and agents drive bb through the same CLI and API you do. On
          your machine, in one SQLite file.
        </p>

        <div className="cta-row">
          <DownloadLink placement="hero" className="btn btn-primary">
            Download for macOS
          </DownloadLink>
          <GitHubLink placement="hero" className="btn btn-ghost">
            Star on GitHub
          </GitHubLink>
        </div>

        <InstallCommand placement="hero" />
        <p className="fine">
          macOS (Apple Silicon) · runs anywhere with Node 22 and Git · MIT
          licensed
        </p>

        <div className="providers">
          <span className="label">Works with</span>
          <span className="chip">Claude Code</span>
          <span className="chip">Codex</span>
          <span className="chip">Pi</span>
        </div>
      </header>

      <section className="features">
        <h2 className="sec-title">One place for you and your agents.</h2>
        <p className="sec-sub">
          Stop juggling terminal tabs. bb gives every agent a thread — and
          gives agents the same controls it gives you.
        </p>
        <div className="grid">
          <div className="card hl">
            <h3>The IDE agents can drive</h3>
            <p>
              Agents spawn threads, message other agents, and schedule
              follow-up work through the same <code>bb</code> CLI you use.
            </p>
          </div>
          <div className="card">
            <h3>Threads, not chat tabs</h3>
            <p>
              Every unit of work has status, events, output, files, an
              environment, and optional parent/child structure.
            </p>
          </div>
          <div className="card">
            <h3>Steer work while it runs</h3>
            <p>
              Queue follow-ups, steer active turns, stop stuck work, or hand a
              task to another thread without losing the trail.
            </p>
          </div>
          <div className="card hl">
            <h3>Local-first</h3>
            <p>
              Server and daemon run on your machine. State is one SQLite file
              under <code>~/.bb</code>. No cloud, no lock-in.
            </p>
          </div>
          <div className="card">
            <h3>Workspaces, managed or not</h3>
            <p>
              Run agents in your existing folders or in bb-managed git
              worktrees — isolated when you want, in place when you don&apos;t.
            </p>
          </div>
          <div className="card">
            <h3>Multi-agent workflows</h3>
            <p>
              Encode bigger fan-outs as workflow files that launch provider
              agents with deterministic, resumable orchestration.
            </p>
          </div>
        </div>
      </section>

      <section className="how">
        <div className="steps">
          <div className="step">
            <div className="num">1</div>
            <h3>Install</h3>
            <p>
              Download the macOS app, or run <code>{CLI_COMMAND}</code>.
            </p>
          </div>
          <div className="step">
            <div className="num">2</div>
            <h3>Point it at a repo</h3>
            <p>
              bb provisions workspaces — managed worktrees or your existing
              checkout.
            </p>
          </div>
          <div className="step">
            <div className="num">3</div>
            <h3>Spawn threads</h3>
            <p>
              From the UI, CLI, or API. Watch and steer — and let agents spawn
              threads of their own.
            </p>
          </div>
        </div>
      </section>

      <section className="closer">
        <h2 className="sec-title">Your agents. Your machine. One IDE.</h2>
        <p>Free and open source. Install in under a minute.</p>
        <div className="cta-row">
          <DownloadLink placement="closer" className="btn btn-primary">
            Download for macOS
          </DownloadLink>
          <GitHubLink placement="closer" className="btn btn-ghost">
            View on GitHub
          </GitHubLink>
        </div>
      </section>

      <footer className="footer">
        <span>bb — open source under MIT</span>
        <span>
          <GitHubLink placement="footer">GitHub</GitHubLink>
          {" · "}
          <DownloadLink placement="footer">Download</DownloadLink>
        </span>
      </footer>
    </div>
  );
}
