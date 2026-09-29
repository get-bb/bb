import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AppCommandId, AppKeybinding } from "@bb/domain";
import { systemConfigQueryKey } from "@/hooks/queries/query-keys";
import { SplitPreviewProvider } from "@/lib/define-split";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import {
  AppCommandProvider,
  useAppCommandHandler,
  useAppCommandRunner,
} from "./AppCommandProvider";
import { CommandPalette } from "./CommandPalette";
import { LazyCommandPaletteBody } from "./LazyCommandPaletteBody";

export default { title: "performance/Command palette split" };

type ReviewState = "loading" | "error" | "live";

const RELEASED_PREVIEW_ID = "command-palette-review-released";

function binding(
  command: AppCommandId,
  key: string,
  shift: boolean,
): AppKeybinding {
  return {
    command,
    desktopOnly: false,
    shortcut: {
      key,
      mod: true,
      meta: false,
      control: false,
      alt: false,
      shift,
    },
    when: { all: ["mainSurface"], none: ["modalOpen"] },
  };
}

const KEYBINDINGS = [
  binding("palette.open", "p", true),
  binding("thread.search", "k", false),
  binding("thread.new", "o", true),
  binding("terminal.open", "j", false),
];

const STORY_COMMANDS: readonly AppCommandId[] = [
  "thread.new",
  "panel.toggle",
  "terminal.open",
  "composer.focus",
];

function StoryCommand({
  command,
  onRun,
}: {
  command: AppCommandId;
  onRun: (command: AppCommandId) => void;
}) {
  useAppCommandHandler(command, () => {
    onRun(command);
    return true;
  });
  return null;
}

function Controls({
  state,
  setState,
  lastCommand,
}: {
  state: ReviewState;
  setState: (state: ReviewState) => void;
  lastCommand: string | null;
}) {
  const runner = useAppCommandRunner();
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const [releaseTimer, setReleaseTimer] = useState<number | null>(null);
  const openedOnMountRef = useRef(false);
  useEffect(() => {
    if (openedOnMountRef.current) return;
    openedOnMountRef.current = true;
    openButtonRef.current?.focus();
    runner.dispatch("palette.open", openButtonRef.current);
  }, [runner]);
  useEffect(
    () => () => {
      if (releaseTimer !== null) window.clearTimeout(releaseTimer);
    },
    [releaseTimer],
  );
  return (
    <div className="space-y-2 p-4 text-sm">
      <div className="flex flex-wrap gap-3" aria-label="Split review controls">
        <button type="button" onClick={() => setState("loading")}>
          Hold loading
        </button>
        <button type="button" onClick={() => setState("error")}>
          Show failure
        </button>
        <button type="button" onClick={() => setState("live")}>
          Release to real UI
        </button>
        <button
          type="button"
          onClick={() =>
            setReleaseTimer(window.setTimeout(() => setState("live"), 4000))
          }
        >
          Release in 4 s
        </button>
        <button
          ref={openButtonRef}
          type="button"
          onClick={(event) =>
            runner.dispatch("palette.open", event.currentTarget)
          }
        >
          Open palette
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        {LazyCommandPaletteBody.id}: {state}. Ctrl/⌘ Shift P opens the palette,
        Ctrl/⌘ K opens thread search. Last command: {lastCommand ?? "none"}
      </p>
    </div>
  );
}

function Review({
  initial,
  releaseAfterMs,
}: {
  initial: ReviewState;
  releaseAfterMs?: number;
}) {
  const queryClient = useQueryClient();
  const [ready] = useState(() => {
    queryClient.setQueryData(
      systemConfigQueryKey(),
      makeSystemConfig({
        keybindings: KEYBINDINGS,
        defaultKeybindings: KEYBINDINGS,
      }),
    );
    return true;
  });
  const [state, setState] = useState<ReviewState>(initial);
  useEffect(() => {
    if (releaseAfterMs === undefined) return;
    const timeout = window.setTimeout(() => setState("live"), releaseAfterMs);
    return () => window.clearTimeout(timeout);
  }, [releaseAfterMs]);
  const [lastCommand, setLastCommand] = useState<string | null>(null);
  if (!ready) return null;
  return (
    <SplitPreviewProvider
      id={state === "live" ? RELEASED_PREVIEW_ID : LazyCommandPaletteBody.id}
      state={state === "live" ? "loading" : state}
      onRetry={() => setState("live")}
    >
      <AppCommandProvider>
        {STORY_COMMANDS.map((command) => (
          <StoryCommand
            key={command}
            command={command}
            onRun={setLastCommand}
          />
        ))}
        <CommandPalette threadId={null} projectId={null} />
        <Controls state={state} setState={setState} lastCommand={lastCommand} />
      </AppCommandProvider>
    </SplitPreviewProvider>
  );
}

export const Loading = () => <Review initial="loading" />;

export const LoadingReleasesAfterFourSeconds = () => (
  <Review initial="loading" releaseAfterMs={4000} />
);

export const Failure = () => <Review initial="error" />;

export const Loaded = () => <Review initial="live" />;
