import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { trackLandingEvent } from "../analytics";
import appScreenshot from "../assets/bb-app.webp";
import bbIcon from "../assets/bb-icon.png";
import { ClaudeIcon, OpenAiIcon, PiIcon } from "../icons";
import type { CtaPlacement } from "../site";
import { CLI_COMMAND, GITHUB_URL, downloadMacosHref } from "../site";

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
    <a className={className} href={downloadMacosHref(placement)}>
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
  const copy = () => {
    // Track and show feedback first; the clipboard write can reject (no user
    // activation, permissions) and must not swallow the event.
    trackLandingEvent({
      name: "landing_cli_command_copied",
      properties: { placement, command: CLI_COMMAND },
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    navigator.clipboard.writeText(CLI_COMMAND).catch(() => {});
  };
  return (
    <div className="install mono">
      <span className="dollar">$</span>
      <span>{CLI_COMMAND}</span>
      <button
        type="button"
        className={copied ? "copied" : undefined}
        onClick={copy}
      >
        {copied ? "✓ Copied" : "Copy"}
      </button>
    </div>
  );
}

type SpotCardProps = {
  title: string;
  children: ReactNode;
};

/** Feature card with a faint cursor-following spotlight. */
function SpotCard({ title, children }: SpotCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const onMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${event.clientX - rect.left}px`);
    el.style.setProperty("--my", `${event.clientY - rect.top}px`);
  };
  return (
    <div ref={ref} className="card" onMouseMove={onMouseMove}>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

/** Fade-up sections as they scroll into view. No-JS and prerender stay fully visible. */
function useScrollReveal() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const targets = Array.from(document.querySelectorAll("[data-reveal]"));
    for (const target of targets) {
      if (target.getBoundingClientRect().top > window.innerHeight * 0.9) {
        target.classList.add("reveal-pending");
      }
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.remove("reveal-pending");
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    for (const target of targets) {
      observer.observe(target);
    }
    return () => observer.disconnect();
  }, []);
}

/**
 * The hero screenshot, rendered with a 3D perspective tilt that eases flat as
 * it scrolls toward the viewport center. Static (tilted) during prerender and
 * under prefers-reduced-motion.
 */
function AppShot() {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (
      !el ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    let raf = 0;
    const update = () => {
      raf = 0;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      // Hold the full tilt while the window sits low in the viewport, then
      // ease flat as its top approaches the upper part of the screen.
      const progress = Math.min(
        1,
        Math.max(0, (vh * 0.62 - rect.top) / (vh * 0.47)),
      );
      const tilt = 18 * (1 - progress);
      const scale = 0.94 + 0.06 * progress;
      el.style.transform = `rotateX(${tilt}deg) scale(${scale})`;
    };
    const schedule = () => {
      if (!raf) {
        raf = requestAnimationFrame(update);
      }
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (raf) {
        cancelAnimationFrame(raf);
      }
    };
  }, []);
  return (
    <section className="shot">
      <img
        ref={ref}
        src={appScreenshot}
        alt="The bb app with a thread open and projects and agent threads in the sidebar"
        width={1392}
        height={912}
      />
    </section>
  );
}

function LandingPage() {
  useScrollReveal();
  return (
    <div className="wrap">
      <nav className="nav">
        <a className="logo" href="/">
          <img src={bbIcon} alt="bb" width={36} height={36} />
        </a>
        <div className="nav-links">
          <GitHubLink placement="nav">GitHub</GitHubLink>
          <DownloadLink placement="nav" className="btn btn-primary btn-sm">
            Download for macOS
          </DownloadLink>
        </div>
      </nav>

      <header className="hero">
        <h1>
          The IDE built for{" "}
          <span className="uline">
            humans and agents
            <svg viewBox="0 0 200 12" preserveAspectRatio="none" aria-hidden>
              <path d="M3 9 C 60 3.5, 140 3.5, 197 7" />
            </svg>
          </span>
          .
        </h1>
        <p className="sub">
          You and your agents both use bb to orchestrate work: you through the
          UI, your agents through a CLI made for them. Claude Code, Codex, and
          Pi, right on your machine.
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

      <AppShot />

      <section className="features" data-reveal>
        <h2 className="sec-title">One place for you and your agents.</h2>
        <p className="sec-sub">
          Stop juggling terminal tabs. bb gives every agent a thread, and
          gives agents the same controls it gives you.
        </p>
        <div className="grid">
          <SpotCard title="The IDE agents can drive">
            Agents spawn threads, message other agents, and schedule follow-up
            work through a <code>bb</code> CLI made for agents.
          </SpotCard>
          <SpotCard title="Local-first">
            bb is free and runs entirely on your machine, using the provider
            subscriptions you already have. No cloud, no lock-in.
          </SpotCard>
          <SpotCard title="Mix providers">
            Have Claude Code manage Codex. Pick the right agent for each task
            and let them coordinate each other.
          </SpotCard>
        </div>
      </section>

      <section className="closer" data-reveal>
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
