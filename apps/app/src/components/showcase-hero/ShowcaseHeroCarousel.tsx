import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useNavigate } from "react-router-dom";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { PluginNewThreadComposer } from "@/components/plugin/PluginNewThreadComposer";
import { useCreateThread } from "@/hooks/mutations/thread-runtime-mutations";
import { getPromptDraftAccessor } from "@/hooks/usePromptDraftStorage";
import { getThreadRoutePath } from "@/lib/route-paths";
import { ShowcaseFrame } from "./ShowcaseFrame";
import type { ShowcaseArchetype, ShowcaseScenes } from "./showcase-archetype";
import { accentInk, accentTint, neutral } from "./showcase-tokens";
import { useReducedMotion } from "./use-reduced-motion";

const SLIDE_MS = 5000;

/**
 * Where each archetype chip orbits the window.
 *
 * The chips live in the stage's gutters — the frame is capped narrower than the
 * stage, so `left-0`/`right-0` lands them beside the window rather than on top
 * of it at any width. They are decoration plus navigation, so they hide below
 * `lg`, where the gutters are too narrow to hold them.
 */
const ORBIT_POSITIONS: readonly CSSProperties[] = [
  { top: "2%", left: 0 },
  { top: "38%", left: 0 },
  { top: "72%", left: 0 },
  { top: "14%", right: 0 },
  { top: "48%", right: 0 },
  { top: "82%", right: 0 },
];

/** Everything the engine says out loud. Each surface supplies its own voice. */
export interface ShowcaseHeroCopy {
  /** Names the carousel region for assistive tech. */
  ariaLabel: string;
  /** Headline lead-in the archetype noun completes, e.g. "Turn bb into". */
  headlineLead: string;
  /** The noun shown once the composer takes over, e.g. "whatever you need". */
  composingNoun: string;
  /** Static line under the headline: what this surface is, in one sentence. */
  description: string;
  /** Names the slide tablist for assistive tech. */
  tablistLabel: string;
  /** Mini-window title prefix, e.g. "bb — ". */
  frameTitlePrefix: string;
  /** Mini-window title-bar badge, e.g. "Plugin". */
  frameBadge: string;
}

/** How the engine seeds bb's real new-thread composer for this surface. */
export interface ShowcaseHeroComposerConfig {
  /** The sentence prefix an archetype brief completes. */
  promptPrefix: string;
  placeholder: string;
  /** Namespaces the composer's saved draft per surface. */
  draftKey: string;
}

export interface ShowcaseHeroCarouselProps {
  archetypes: readonly ShowcaseArchetype[];
  scenes: ShowcaseScenes;
  copy: ShowcaseHeroCopy;
  composer: ShowcaseHeroComposerConfig;
  /** Static rail glyphs for the mini window; omit to render no rail. */
  rail?: readonly IconName[];
  /** Stories force a slide and disable autoplay to capture a stable frame. */
  initialIndex?: number;
  autoplay?: boolean;
  /** Stories render the showcase without the thread-creating composer. */
  composerDisabled?: boolean;
  /**
   * External request to open (or, with `close`, dismiss) the inline composer —
   * an example card, the page's create button. A new nonce applies it; `seed`
   * overrides the default prefix-only seed. The hero owns the composer, so
   * every create affordance on the page funnels here instead of navigating.
   */
  openRequest?: { nonce: number; seed?: string; close?: boolean } | null;
  /** Reports composer open/close so the page can keep the hero region shown. */
  onComposingChange?: (composing: boolean) => void;
}

/**
 * The shared browse-hero engine behind both the Plugins and Skills surfaces:
 * one mini bb window that transforms through a surface's archetypes, orbited by
 * the archetypes it is cycling through.
 *
 * A browse page has two jobs — show what this thing can do, and make building
 * one feel one step away — so the headline states the outcome in plain words
 * while the window shows it.
 *
 * Composing is a MODE, not an inset panel: activating it swaps the showcase out
 * for bb's real new-thread composer in the same block, so the visitor gets the
 * genuine prompt box (mentions, attachments, model/project/environment pickers)
 * rather than a lookalike that drops their selections on the way to a thread.
 * Both states share one grid cell, so the swap cross-fades in place and the
 * page below never jumps.
 */
export function ShowcaseHeroCarousel({
  archetypes,
  scenes,
  copy,
  composer,
  rail,
  initialIndex = 0,
  autoplay = true,
  composerDisabled = false,
  openRequest = null,
  onComposingChange,
}: ShowcaseHeroCarouselProps) {
  const reducedMotion = useReducedMotion();
  const navigate = useNavigate();
  const createThread = useCreateThread();
  // The composer restores its saved draft on mount and only falls back to
  // `initialPrompt` when that draft is empty — the right default for a blank
  // open, but an example card's brief must land even over a leftover draft,
  // so explicit seeds REPLACE the stored draft before the composer mounts.
  // Imperative access on purpose: subscribing here would re-render the whole
  // carousel on every keystroke the mounted composer writes.
  const promptDraft = useMemo(
    () =>
      getPromptDraftAccessor({
        kind: "plugin-new-thread",
        key: composer.draftKey,
      }),
    [composer.draftKey],
  );
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [interacting, setInteracting] = useState(false);
  const [documentHidden, setDocumentHidden] = useState(false);
  // Null while showcasing. Holds the seed prompt for the composer once open,
  // and remounts it (via `composerKey`) so a new seed always takes effect.
  const [composerSeed, setComposerSeed] = useState<string | null>(null);
  const [composerKey, setComposerKey] = useState(0);
  const tabsRef = useRef<HTMLDivElement>(null);

  const composing = composerSeed !== null;
  const active = archetypes[activeIndex] ?? archetypes[0];
  const paused =
    !autoplay || reducedMotion || interacting || composing || documentHidden;

  useEffect(() => {
    if (typeof document === "undefined") return;
    const update = () => setDocumentHidden(document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  // Composing-state changes flow from the two events that cause them (open,
  // close), not from an effect. The transition is tracked in a ref so the
  // parent callback fires exactly once per real change and the state updater
  // stays pure (updaters run during render and re-run under StrictMode).
  const composingRef = useRef(false);
  const setSeedAndNotify = useCallback(
    (seed: string | null, options?: { replaceDraft?: boolean }) => {
      if (seed !== null && options?.replaceDraft === true) {
        promptDraft.setDraft({
          text: seed,
          mentions: [],
          // A brief replaces what the composer says, not what's attached.
          attachments: promptDraft.getCurrent().attachments,
        });
      }
      const willCompose = seed !== null;
      if (composingRef.current !== willCompose) {
        composingRef.current = willCompose;
        onComposingChange?.(willCompose);
      }
      setComposerSeed(seed);
      if (seed !== null) setComposerKey((current) => current + 1);
    },
    [onComposingChange, promptDraft],
  );

  // A repeated nonce is a no-op; each distinct request opens (or re-seeds) the
  // composer even if it is already open, so a second card click still lands.
  const handledRequestNonce = useRef<number | null>(null);
  useEffect(() => {
    if (composerDisabled) return;
    if (
      openRequest === null ||
      openRequest.nonce === handledRequestNonce.current
    ) {
      return;
    }
    handledRequestNonce.current = openRequest.nonce;
    // The rule's own exception: `openRequest` is an external command channel,
    // and this effect is the subscription callback that applies it. The
    // render-phase alternative would call `onComposingChange` — parent
    // setState — during render. A request carrying a seed is an explicit
    // choice (a card, a menu example), so it replaces the stored draft; a
    // seedless request behaves like the blank CTA and restores it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSeedAndNotify(
      openRequest.close === true
        ? null
        : (openRequest.seed ?? composer.promptPrefix),
      { replaceDraft: !openRequest.close && openRequest.seed !== undefined },
    );
  }, [composer.promptPrefix, composerDisabled, openRequest, setSeedAndNotify]);

  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => {
      setActiveIndex((current) => (current + 1) % archetypes.length);
    }, SLIDE_MS);
    return () => window.clearTimeout(timer);
  }, [activeIndex, archetypes.length, paused]);

  const focusTab = useCallback((index: number) => {
    const tabs =
      tabsRef.current?.querySelectorAll<HTMLButtonElement>("[role='tab']");
    tabs?.[index]?.focus();
  }, []);

  const handleTabKeyDown = (event: React.KeyboardEvent) => {
    const last = archetypes.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowRight")
      next = activeIndex === last ? 0 : activeIndex + 1;
    else if (event.key === "ArrowLeft")
      next = activeIndex === 0 ? last : activeIndex - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    if (next === null) return;
    event.preventDefault();
    setActiveIndex(next);
    focusTab(next);
  };

  if (active === undefined) return null;

  return (
    <section
      aria-roledescription="carousel"
      aria-label={copy.ariaLabel}
      className="flex flex-col items-center pb-4"
      onPointerEnter={() => setInteracting(true)}
      onPointerLeave={() => setInteracting(false)}
      onFocusCapture={() => setInteracting(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setInteracting(false);
        }
      }}
    >
      <h2 className="text-center text-2xl font-semibold tracking-tight text-foreground">
        {copy.headlineLead}{" "}
        <span
          // Keyed so each slide's noun cross-fades in rather than swapping.
          key={composing ? "composing" : active.id}
          className={cn(
            "inline-block",
            !reducedMotion &&
              "animate-in fade-in slide-in-from-bottom-1 duration-500",
          )}
          style={{
            color: composing
              ? "var(--foreground)"
              : accentInk(active.accentToken, 72),
          }}
        >
          {composing ? copy.composingNoun : active.noun}
        </span>
      </h2>
      <p className="mt-1.5 max-w-prose text-center text-sm text-muted-foreground">
        {copy.description}
      </p>

      {/* One grid cell holds both states, so the composer cross-fades into the
          showcase's place instead of pushing the catalog down the page. */}
      <div className="relative mt-5 grid w-full max-w-[58rem] grid-cols-1 grid-rows-1">
        <div
          className={cn(
            "relative [grid-area:1/1]",
            !reducedMotion &&
              "transition-[opacity,transform,filter] duration-300 ease-out",
            composing
              ? "pointer-events-none scale-[0.97] opacity-0 blur-[2px]"
              : "scale-100 opacity-100 blur-0",
          )}
          // Hidden from AT while the composer owns the slot. Nothing inside is
          // focusable — the chips are tabIndex -1 and the tablist lives in the
          // row below — so aria-hidden here cannot strand keyboard focus.
          aria-hidden={composing}
        >
          {archetypes.map((archetype, index) => {
            const position = ORBIT_POSITIONS[index];
            if (position === undefined) return null;
            const isActive = index === activeIndex;
            return (
              <button
                key={archetype.id}
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                onClick={() => setActiveIndex(index)}
                style={
                  {
                    ...position,
                    "--bb-hero-drift-duration": `${6 + index * 0.7}s`,
                    "--bb-hero-drift-delay": `${index * 0.45}s`,
                    background: isActive
                      ? accentTint(archetype.accentToken, 12)
                      : "var(--canvas)",
                    borderColor: isActive
                      ? accentTint(archetype.accentToken, 40)
                      : neutral(13),
                    color: isActive
                      ? accentInk(archetype.accentToken, 62)
                      : neutral(46),
                  } as CSSProperties
                }
                className={cn(
                  "bb-hero-chip absolute z-10 hidden max-w-[9rem] cursor-pointer items-center gap-1.5",
                  "rounded-lg border px-2 py-1.5 text-2xs font-medium shadow-sm lg:flex",
                  "transition-[opacity,transform,background-color,border-color] duration-500",
                  isActive ? "opacity-100" : "opacity-70 hover:opacity-100",
                )}
              >
                <Icon name={archetype.icon} className="size-3 shrink-0" />
                <span className="truncate">{archetype.title}</span>
              </button>
            );
          })}

          <ShowcaseFrame
            archetypes={archetypes}
            activeIndex={activeIndex}
            scenes={scenes}
            titlePrefix={copy.frameTitlePrefix}
            badge={copy.frameBadge}
            rail={rail}
            reducedMotion={reducedMotion}
            // 13rem fits the densest scenes (the prototype grid and the inbox
            // with its handoff line) without a bottom clip.
            className="mx-auto h-[13rem] w-full max-w-[38rem] lg:w-[66%]"
          />
        </div>

        {composing ? (
          <div
            className={cn(
              "z-20 self-center [grid-area:1/1]",
              !reducedMotion &&
                "animate-in fade-in slide-in-from-bottom-2 duration-300",
            )}
          >
            <div className="mx-auto w-full max-w-[44rem]">
              <PluginNewThreadComposer
                // Remounting per open re-seeds the prompt; the composer treats
                // initialPrompt as a mount-time seed, not a controlled value.
                key={composerKey}
                initialPrompt={composerSeed ?? undefined}
                placeholder={composer.placeholder}
                draftKey={composer.draftKey}
                focusRequest={composerKey}
                onSubmit={async (request) => {
                  const thread = await createThread.mutateAsync({
                    input: request.input,
                    projectId: request.projectId,
                    providerId: request.providerId,
                    model: request.model,
                    reasoningLevel: request.reasoningLevel,
                    permissionMode: request.permissionMode,
                    ...(request.serviceTier
                      ? { serviceTier: request.serviceTier }
                      : {}),
                    executionInputSources: request.executionInputSources,
                    environment: request.environment,
                  });
                  navigate(
                    getThreadRoutePath({
                      projectId: thread.projectId ?? request.projectId,
                      threadId: thread.id,
                    }),
                  );
                }}
              />
            </div>
          </div>
        ) : null}
      </div>

      {!composing ? (
        <div className="mt-4 flex min-h-4 flex-col items-center gap-3">
          <div
            ref={tabsRef}
            role="tablist"
            aria-label={copy.tablistLabel}
            className="flex items-center gap-1.5"
            onKeyDown={handleTabKeyDown}
          >
            {archetypes.map((archetype, index) => {
              const isActive = index === activeIndex;
              return (
                <button
                  key={archetype.id}
                  role="tab"
                  type="button"
                  aria-selected={isActive}
                  aria-label={archetype.title}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setActiveIndex(index)}
                  className={cn(
                    "group h-4 cursor-pointer rounded-full px-0 focus-visible:ring-1",
                    "focus-visible:ring-ring focus-visible:outline-none",
                  )}
                >
                  <span
                    className={cn(
                      "block h-1 overflow-hidden rounded-full transition-all duration-300",
                      isActive ? "w-10" : "w-4",
                    )}
                    style={{
                      background: isActive
                        ? accentTint(archetype.accentToken, 22)
                        : neutral(14),
                    }}
                  >
                    {isActive ? (
                      <span
                        // Keyed by slide so the fill restarts each advance.
                        key={`${archetype.id}-${activeIndex}`}
                        data-paused={paused}
                        className="bb-hero-progress-fill block h-full w-full"
                        style={
                          {
                            "--bb-hero-slide-duration": `${SLIDE_MS}ms`,
                            background: `var(${archetype.accentToken})`,
                          } as CSSProperties
                        }
                      />
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
