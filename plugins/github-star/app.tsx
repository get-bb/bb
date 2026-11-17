import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  definePluginApp,
  experimental_usePluginId,
  useBbNavigate,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { githubStarRpcContract } from "./server.js";

export const REPOSITORY_URL = "https://github.com/get-bb/bb";
export const IDLE_MS = 30_000;
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "focus"] as const;
const TOAST_ID = "github-star";

function waitForActivity(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      for (const type of ACTIVITY_EVENTS) {
        window.removeEventListener(type, done, true);
      }
      signal.removeEventListener("abort", done);
      resolve();
    };
    for (const type of ACTIVITY_EVENTS) {
      window.addEventListener(type, done, { capture: true, passive: true });
    }
    signal.addEventListener("abort", done);
  });
}

function waitForIdle(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      clearTimeout(timer);
      for (const type of ACTIVITY_EVENTS) {
        window.removeEventListener(type, restart, true);
      }
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const restart = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (
          !document.hasFocus() ||
          document.activeElement?.matches("iframe, webview")
        ) {
          return;
        }
        finish();
      }, IDLE_MS);
    };
    for (const type of ACTIVITY_EVENTS) {
      window.addEventListener(type, restart, { capture: true, passive: true });
    }
    signal.addEventListener("abort", finish);
    restart();
  });
}

interface StarToastProps {
  onStar: () => void;
  pluginId: string;
  toastId: string | number;
}

function StarToast({ onStar, pluginId, toastId }: StarToastProps) {
  return (
    <div
      data-bb-plugin={pluginId}
      className="w-[var(--width,356px)] max-w-[calc(100vw-32px)] shrink-0 rounded-md border border-border bg-popover px-4 py-3 text-popover-foreground shadow-sm max-[600px]:w-[calc(100vw-32px)]"
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-foreground">
          <Icon name="GithubLogo" className="size-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium leading-5">Enjoying bb?</div>
          <div className="mt-0.5 flex min-w-0 flex-col items-start gap-2 text-xs leading-5 text-muted-foreground">
            <div>A star on GitHub helps bb grow.</div>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto shrink-0 px-0 py-0 text-xs text-muted-foreground underline underline-offset-4"
              onClick={() => {
                onStar();
                toast.dismiss(toastId);
              }}
            >
              Star on GitHub
            </Button>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-mr-1 -mt-1 size-6 shrink-0 text-muted-foreground"
          aria-label="Dismiss"
          onClick={() => toast.dismiss(toastId)}
        >
          <Icon name="X" className="size-3.5" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

function GitHubStarPrompt() {
  const rpc = useRpc<typeof githubStarRpcContract>();
  const navigate = useBbNavigate();
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);
  const pluginId = experimental_usePluginId();

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const run = async () => {
      while (!signal.aborted) {
        await waitForIdle(signal);
        if (signal.aborted) return;
        const { outcome } = await rpc.call("claim", null);
        if (outcome === "done") return;
        if (outcome === "show") {
          toast.custom(
            (id) => (
              <StarToast
                onStar={() => navigateRef.current.openUrl(REPOSITORY_URL)}
                pluginId={pluginId}
                toastId={id}
              />
            ),
            { id: TOAST_ID, className: "bb-app-toast", duration: Infinity },
          );
          return;
        }
        await waitForActivity(signal);
      }
    };
    run().catch(() => undefined);
    return () => controller.abort();
  }, [pluginId, rpc]);

  return null;
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({
    id: "prompt",
    component: GitHubStarPrompt,
  });
});
