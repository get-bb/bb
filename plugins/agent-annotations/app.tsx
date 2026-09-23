import { useCallback, useEffect, useRef, useState } from "react";
import { CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS } from "@/components/ui/chrome-style-tokens";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@/components/ui/coarse-pointer-sizing";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  definePluginApp,
  useComposer,
  useRpc,
  type ExperimentalPluginBrowserPage,
  type ExperimentalPluginBrowserToolbarActionProps,
  type JsonValue,
} from "@get-bb/plugin-sdk/app";
import {
  ANNOTATION_MENTION_PROVIDER_ID,
  annotationMentionLabel,
  pageMessageSchema,
  pageStateSchema,
  reactProbeSchema,
  type PageAnnotation,
  type PageState,
  type ReactComponent,
} from "./annotations.js";
import {
  THEME_TOKENS,
  buildActivateExpression,
  buildControllerExpression,
  buildReactProbeExpression,
} from "./page-script.js";
import type { agentAnnotationsRpcContract } from "./server.js";

const INACTIVE_STATE: PageState = { active: false, count: 0 };

function readTheme(): Record<string, string> {
  const computed = getComputedStyle(document.documentElement);
  const theme: Record<string, string> = {};
  for (const token of THEME_TOKENS) {
    const value = computed.getPropertyValue(`--${token}`).trim();
    if (value.length > 0) {
      theme[`--bb-${token}`] = value;
    }
  }
  return theme;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function readReactComponents(
  page: ExperimentalPluginBrowserPage,
  annotationId: string,
): Promise<ReactComponent[]> {
  try {
    const parsed = reactProbeSchema.safeParse(
      await page.evaluate(buildReactProbeExpression(annotationId), {
        world: "main",
      }),
    );
    return parsed.success && parsed.data !== null ? parsed.data.components : [];
  } catch {
    return [];
  }
}

export function AnnotateAction({
  url,
  experimental_page: page,
}: ExperimentalPluginBrowserToolbarActionProps) {
  const composer = useComposer();
  const rpc = useRpc<typeof agentAnnotationsRpcContract>();
  const composerRef = useRef(composer);
  const pendingSaves = useRef(Promise.resolve());
  composerRef.current = composer;
  const [state, setState] = useState<PageState>(INACTIVE_STATE);
  const [error, setError] = useState<string | null>(null);

  const applyState = useCallback((value: JsonValue) => {
    const parsed = pageStateSchema.safeParse(value);
    setState(parsed.success ? parsed.data : INACTIVE_STATE);
  }, []);

  const addToPrompt = useCallback(
    async (annotation: PageAnnotation) => {
      if (page === null) {
        return;
      }
      const components = await readReactComponents(page, annotation.id);
      const saved = await rpc.call("save", { ...annotation, components });
      composerRef.current.insertMention({
        provider: ANNOTATION_MENTION_PROVIDER_ID,
        id: saved.id,
        label: annotationMentionLabel(annotation),
      });
    },
    [page, rpc],
  );

  useEffect(() => {
    if (page === null) {
      return;
    }
    return page.onMessage((data) => {
      const parsed = pageMessageSchema.safeParse(data);
      if (!parsed.success) {
        return;
      }
      if (parsed.data.type === "state") {
        setState({ active: parsed.data.active, count: parsed.data.count });
        return;
      }
      const message = parsed.data;
      pendingSaves.current = pendingSaves.current
        .then(async () => {
          if (message.type === "annotation-delete") {
            composerRef.current.experimental_removeMention({
              provider: ANNOTATION_MENTION_PROVIDER_ID,
              id: message.id,
            });
          } else if (message.type === "annotation-update") {
            await rpc.call("update", {
              id: message.id,
              comment: message.comment,
            });
          } else {
            await addToPrompt(message.annotation);
          }
          setError(null);
        })
        .catch((cause: unknown) => {
          setError(errorMessage(cause));
        });
    });
  }, [addToPrompt, page, rpc]);

  useEffect(() => {
    if (page === null) {
      return;
    }
    page
      .evaluate(buildControllerExpression("state"))
      .then(applyState, () => setState(INACTIVE_STATE));
  }, [applyState, page, url]);

  useEffect(
    () => () => {
      page
        ?.evaluate(buildControllerExpression("deactivate"))
        .catch(() => undefined);
    },
    [page],
  );

  useEffect(
    () =>
      composer.experimental_onSubmitted(() => {
        pendingSaves.current = pendingSaves.current
          .then(async () => {
            if (page !== null)
              applyState(
                await page.evaluate(buildControllerExpression("clear")),
              );
          })
          .catch((cause: unknown) => setError(errorMessage(cause)));
      }),
    // oxlint-disable-next-line react/exhaustive-deps
    [composer.experimental_onSubmitted, page, applyState],
  );

  const toggle = useCallback(() => {
    if (page === null) {
      return;
    }
    setError(null);
    const expression = state.active
      ? buildControllerExpression("deactivate")
      : buildActivateExpression(readTheme());
    page.evaluate(expression).then(applyState, (cause: unknown) => {
      setError(errorMessage(cause));
    });
  }, [applyState, page, state.active]);

  const label =
    page === null
      ? "Annotate elements is available in the desktop app"
      : state.active
        ? "Stop annotating"
        : "Annotate elements";
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={state.active}
      disabled={page === null}
      onClick={toggle}
      title={error ?? label}
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-md transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
        COARSE_POINTER_HEADER_ICON_BUTTON_CLASS,
        state.active
          ? "bg-state-active text-foreground"
          : CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS,
        error !== null && "text-destructive",
      )}
    >
      <Icon name="MessageSquarePlus" aria-hidden />
      {state.count > 0 ? (
        <span
          data-testid="agent-annotations-count"
          className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-xs leading-none text-primary-foreground"
        >
          {state.count}
        </span>
      ) : null}
    </button>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_browserToolbarAction({
    id: "annotate",
    title: "Agent annotations",
    component: AnnotateAction,
  });
});
