import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import { trackLandingEvent } from "../analytics";
import type { CtaPlacement } from "../analytics";
import appScreenshot from "../assets/bb-app.webp";
import { ClaudeIcon, OpenAiIcon, PiIcon } from "../icons";
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
        <h1>The IDE agents can use themselves.</h1>
        <p className="sub">
          bb runs Claude Code, Codex, and Pi as threads you can watch and
          steer. Agents drive bb through a CLI and API built for them, right
          on your machine.
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
          Free and open source · macOS (Apple Silicon) · runs anywhere with
          Node 22 and Git
        </p>

        <div className="providers">
          <span className="label">Works with</span>
          <span className="chip">
            <ClaudeIcon className="chip-icon" />
            Claude Code
          </span>
          <span className="chip">
            <OpenAiIcon className="chip-icon" />
            Codex
          </span>
          <span className="chip">
            <PiIcon className="chip-icon" />
            Pi
          </span>
        </div>
      </header>

      <section className="shot">
        <img
          src={appScreenshot}
          alt="The bb app with a thread open and projects and agent threads in the sidebar"
          width={1392}
          height={912}
        />
      </section>

      <section className="features">
        <h2 className="sec-title">One place for you and your agents.</h2>
        <p className="sec-sub">
          Stop juggling terminal tabs. bb gives every agent a thread, and
          gives agents the same controls it gives you.
        </p>
        <div className="grid">
          <div className="card">
            <h3>The IDE agents can drive</h3>
            <p>
              Agents spawn threads, message other agents, and schedule
              follow-up work through a <code>bb</code> CLI made for agents.
            </p>
          </div>
          <div className="card">
            <h3>Local-first</h3>
            <p>
              bb is free and runs entirely on your machine, using the provider
              subscriptions you already have. No cloud, no lock-in.
            </p>
          </div>
          <div className="card">
            <h3>Mix providers</h3>
            <p>
              Have Claude Code manage Codex. Pick the right agent for each
              task and let them coordinate each other.
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
        <span>bb is free and open source (MIT)</span>
        <span>
          <GitHubLink placement="footer">GitHub</GitHubLink>
          {" · "}
          <DownloadLink placement="footer">Download</DownloadLink>
        </span>
      </footer>
    </div>
  );
}
