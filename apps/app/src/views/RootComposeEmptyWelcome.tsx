import { useEffect, useState } from "react";
import { Icon, type IconName } from "@/components/ui/icon";

interface RootComposeEmptyWelcomeProps {
  /** Reveal the composer, optionally prefilled with a starter prompt. */
  onCompose: (prompt?: string) => void;
  onAddProject: () => void;
  addProjectDisabled?: boolean;
}

const IMPORT_PROJECTS_PROMPT =
  "Search my home directory (max depth 3) for git repositories touched in the last 30 days and import only those projects into bb using the cli";

const LEARN_PROMPT =
  "What can bb do, and how can you (my agent) interact with it? Summarize bb's capabilities and how you'd use the bb CLI to work with threads and projects.";

interface WelcomeActionProps {
  icon: IconName;
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

function WelcomeAction({
  icon,
  title,
  description,
  onClick,
  disabled,
}: WelcomeActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
    >
      <Icon
        name={icon}
        aria-hidden
        className="size-5 shrink-0 text-subtle-foreground group-hover:text-foreground"
      />
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-medium text-foreground">{title}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

/**
 * Centered branded landing shown on the root compose page when the user has no
 * projects yet. Mirrors a logo-over-actions welcome layout: a dimensional bb
 * mark sits above the primary "get started" actions.
 */
export function RootComposeEmptyWelcome({
  onCompose,
  onAddProject,
  addProjectDisabled,
}: RootComposeEmptyWelcomeProps) {
  const reducedMotion = usePrefersReducedMotion();
  return (
    <div className="flex flex-col items-center gap-12 duration-500 animate-in fade-in-0 slide-in-from-bottom-2">
      {/* Real specular highlight: a blurred copy of the mark's alpha is the bump
          map, and feSpecularLighting lit by a moving point light produces a
          glint that follows the surface curvature (and travels) the way light
          actually reflects — far less "stuck-on" than a flat sweeping band. The
          highlight is clipped just inside the glyph and added over it so the
          light does not brighten antialiased outer-edge pixels. */}
      <svg aria-hidden className="absolute h-0 w-0" focusable="false">
        <defs>
          <filter
            id="bb-gloss"
            x="-40%"
            y="-40%"
            width="180%"
            height="180%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur in="SourceAlpha" stdDeviation="5" result="bump" />
            <feSpecularLighting
              in="bump"
              surfaceScale="5"
              specularConstant="0.85"
              specularExponent="18"
              lightingColor="#ffffff"
              result="spec"
            >
              <fePointLight x="40" y="10" z="80">
                {reducedMotion ? null : (
                  // Ping-pong the light out and back between points far off the
                  // glyph (so each pass fades fully to matte). Returning to the
                  // exact start means no position jump on repeat — it eases to a
                  // stop at each end and reverses, so the loop never snaps.
                  <animate
                    attributeName="x"
                    dur="5s"
                    repeatCount="indefinite"
                    calcMode="spline"
                    keyTimes="0;0.5;1"
                    values="-170;270;-170"
                    keySplines="0.42 0 0.58 1;0.42 0 0.58 1"
                  />
                )}
              </fePointLight>
            </feSpecularLighting>
            <feMorphology
              in="SourceAlpha"
              operator="erode"
              radius="0.75"
              result="innerAlpha"
            />
            <feComposite
              in="spec"
              in2="innerAlpha"
              operator="in"
              result="specClip"
            />
            <feComposite
              in="SourceGraphic"
              in2="specClip"
              operator="arithmetic"
              k1="0"
              k2="1"
              k3="1"
              k4="0"
            />
          </filter>
        </defs>
      </svg>
      {/* Filter on the parent so its SourceAlpha is the masked glyph below. */}
      <div
        role="img"
        aria-label="bb"
        className="h-24 w-28 select-none"
        style={{ filter: "url(#bb-gloss)" }}
      >
        <div className="bb-mark-fill size-full" />
      </div>
      <div className="flex w-full max-w-[360px] flex-col gap-1">
        <WelcomeAction
          icon="MessageSquarePlus"
          title="New thread"
          description="Start a new conversation"
          onClick={() => onCompose()}
        />
        <WelcomeAction
          icon="FolderGit"
          title="Automatically import my projects"
          description="Find repos touched in the last 30 days"
          onClick={() => onCompose(IMPORT_PROJECTS_PROMPT)}
        />
        <WelcomeAction
          icon="FolderPlus"
          title="New project"
          description="Create one from a local folder"
          onClick={onAddProject}
          disabled={addProjectDisabled}
        />
        <WelcomeAction
          icon="Explore"
          title="Learn what bb can do"
          description="Get a tour of its capabilities"
          onClick={() => onCompose(LEARN_PROMPT)}
        />
      </div>
    </div>
  );
}
