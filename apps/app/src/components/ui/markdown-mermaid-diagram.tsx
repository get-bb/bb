import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import type { MermaidConfig, RenderResult } from "mermaid";
import { CopyButton } from "./copy-button.js";
import { loadMermaid } from "./markdown-mermaid-loader.js";
import type { Theme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

export interface MarkdownMermaidDiagramProps {
  preferredTheme: Theme;
  source: string;
}

interface RenderedMermaidDiagram {
  bindFunctions: RenderResult["bindFunctions"];
  svg: string;
}

type MermaidRenderState =
  | { kind: "loading" }
  | { kind: "rendered"; diagram: RenderedMermaidDiagram }
  | { kind: "error" };

type MermaidTheme = NonNullable<MermaidConfig["theme"]>;
type MermaidDiagramContainerProps = ComponentPropsWithoutRef<"div">;

const MERMAID_DARK_THEME: MermaidTheme = "dark";
const MERMAID_LIGHT_THEME: MermaidTheme = "default";
const MERMAID_RENDER_ID_PREFIX = "bb-mermaid";
const MERMAID_RENDER_ID_SAFE_CHARACTER_PATTERN = /[^a-zA-Z0-9_-]/gu;

function getMermaidTheme(preferredTheme: Theme): MermaidTheme {
  return preferredTheme === "dark" ? MERMAID_DARK_THEME : MERMAID_LIGHT_THEME;
}

function buildMermaidConfig(preferredTheme: Theme): MermaidConfig {
  return {
    darkMode: preferredTheme === "dark",
    fontFamily: "Inter, sans-serif",
    securityLevel: "strict",
    startOnLoad: false,
    suppressErrorRendering: true,
    theme: getMermaidTheme(preferredTheme),
  };
}

function buildMermaidRenderId(reactId: string): string {
  const safeId = reactId.replace(MERMAID_RENDER_ID_SAFE_CHARACTER_PATTERN, "");
  return `${MERMAID_RENDER_ID_PREFIX}-${safeId}`;
}

function MermaidDiagramContainer({
  children,
  className,
  ...containerProps
}: MermaidDiagramContainerProps) {
  return (
    <div
      {...containerProps}
      className={cn(
        "my-2 overflow-hidden rounded-md border border-border bg-surface-recessed",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function MarkdownMermaidDiagram({
  preferredTheme,
  source,
}: MarkdownMermaidDiagramProps) {
  const reactId = useId();
  const diagramElementRef = useRef<HTMLDivElement>(null);
  const renderId = useMemo(() => buildMermaidRenderId(reactId), [reactId]);
  const [renderState, setRenderState] = useState<MermaidRenderState>({
    kind: "loading",
  });

  useEffect(() => {
    let isCurrentRender = true;

    setRenderState({ kind: "loading" });
    loadMermaid()
      .then((mermaid) => {
        mermaid.initialize(buildMermaidConfig(preferredTheme));
        return mermaid.render(renderId, source);
      })
      .then((renderResult) => {
        if (!isCurrentRender) {
          return;
        }

        setRenderState({
          kind: "rendered",
          diagram: {
            bindFunctions: renderResult.bindFunctions,
            svg: renderResult.svg,
          },
        });
      })
      .catch(() => {
        if (!isCurrentRender) {
          return;
        }

        setRenderState({ kind: "error" });
      });

    return () => {
      isCurrentRender = false;
    };
  }, [preferredTheme, renderId, source]);

  useEffect(() => {
    if (renderState.kind !== "rendered") {
      return;
    }

    const diagramElement = diagramElementRef.current;
    if (!diagramElement) {
      return;
    }

    renderState.diagram.bindFunctions?.(diagramElement);
  }, [renderState]);

  return (
    <MermaidDiagramContainer>
      <div className="flex items-center justify-between pl-3 pr-1.5 pt-1.5">
        <span className="font-mono text-xs uppercase text-muted-foreground">
          mermaid
        </span>
        <CopyButton text={source} label="Copy Mermaid source" />
      </div>
      {renderState.kind === "rendered" ? (
        <div className="overflow-x-auto px-3 pb-3 pt-2">
          <div
            ref={diagramElementRef}
            className="min-w-0 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
            role="img"
            aria-label="Mermaid diagram"
            dangerouslySetInnerHTML={{ __html: renderState.diagram.svg }}
          />
        </div>
      ) : null}
      {renderState.kind === "loading" ? (
        <div className="flex min-h-24 items-center justify-center px-3 pb-3 pt-2 text-xs text-muted-foreground">
          Rendering diagram...
        </div>
      ) : null}
      {renderState.kind === "error" ? (
        <div className="space-y-2 px-3 pb-3 pt-2">
          <p className="text-xs text-destructive" role="alert">
            Unable to render Mermaid diagram.
          </p>
          <pre className="max-h-64 overflow-auto rounded-sm border border-border bg-background p-2">
            <code className="font-mono text-xs">{source}</code>
          </pre>
        </div>
      ) : null}
    </MermaidDiagramContainer>
  );
}
