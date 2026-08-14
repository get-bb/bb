import { useCallback, useEffect, useMemo, useState } from "react";
// @ts-expect-error The plugin app builder supplies the React DOM singleton.
import { createPortal } from "react-dom";
import type { EdgeTypes } from "@xyflow/react";
import type { z } from "zod";
import {
  useOptionalArchitectureSelection,
  type ArchitectureSelectionContextValue,
} from "../nodes/selection.js";
import {
  CrossSurfaceLinks,
  type CrossSurfaceLinksState,
} from "./CrossSurfaceLinks.js";
import {
  CanvasLayoutPersistence,
  type CanvasLayoutAppRuntime,
} from "./layout.js";
import {
  type canvasLinksRpcContract,
  type CrossSurfaceLink,
  type CrossSurfaceLinkKind,
  type LinkFamilyReadiness,
  type ResolvedCrossSurfaceLinks,
} from "./schema.js";
import type { ResolvedTaraScope } from "../scope/index.js";

const PROJECT_SCOPE_STORAGE_KEY =
  "finite-state:product-security:project-scope:v1";
const LINK_KINDS = [
  "sbom",
  "firmware",
  "requirement",
  "verification",
] as const satisfies readonly CrossSurfaceLinkKind[];

type AppRuntime = typeof import("@bb/plugin-sdk/app");
export type CanvasLinksAppRuntime = Pick<
  AppRuntime,
  "useBbNavigate" | "useRpc"
> &
  CanvasLayoutAppRuntime;
type FamilyResult = z.output<
  (typeof canvasLinksRpcContract)["canvasSbomLinks"]["output"]
>;

let appRuntimePromise: Promise<AppRuntime> | null = null;

function loadAppRuntime(): Promise<AppRuntime> {
  appRuntimePromise ??= import("@bb/plugin-sdk/app");
  return appRuntimePromise;
}

function readPersistedProjectId(): string | null {
  try {
    const value = localStorage.getItem(PROJECT_SCOPE_STORAGE_KEY);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function safeClientError(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message.slice(0, 300)
    : "The linked surface could not be resolved.";
}

function unavailableFamily(
  kind: CrossSurfaceLinkKind,
  sourceSlug: string,
  error: unknown,
): FamilyResult {
  const message = safeClientError(error);
  return {
    sourceSlug,
    links: [
      {
        kind,
        sourceSlug,
        target: "",
        label:
          kind === "sbom"
            ? "SBOM entry"
            : kind === "firmware"
              ? "Files in firmware"
              : kind === "requirement"
                ? "Mitigating requirements"
                : "Verification runs",
        ready: false,
        reason: "unavailable",
      },
    ],
    readiness: { kind, state: "unavailable", message },
  };
}

function useCrossSurfaceLinks(
  appRuntime: CanvasLinksAppRuntime,
  workspaceProjectId: string | null,
  platformProjectId: string | null,
  projectVersionId: string | null,
  sourceSlug: string | null,
): { state: CrossSurfaceLinksState; retry(): void } {
  const rpc = appRuntime.useRpc<typeof canvasLinksRpcContract>();
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<CrossSurfaceLinksState>(
    workspaceProjectId ? { state: "loading" } : { state: "unconfigured" },
  );
  const retry = useCallback(() => setRevision((current) => current + 1), []);

  useEffect(() => {
    if (!workspaceProjectId) {
      setState({ state: "unconfigured" });
      return;
    }
    if (!sourceSlug) return;
    let active = true;
    setState({ state: "loading" });
    const input = {
      workspaceProjectId,
      platformProjectId,
      projectVersionId,
      sourceSlug,
    };
    void Promise.allSettled([
      rpc.call("canvasSbomLinks", input),
      rpc.call("canvasFirmwareLinks", input),
      rpc.call("canvasRequirementLinks", input),
      rpc.call("canvasVerificationLinks", input),
    ]).then((settled) => {
      if (!active) return;
      const families = settled.map((result, index) => {
        const kind = LINK_KINDS[index];
        if (!kind) throw new Error("Cross-surface link family order drifted.");
        return result.status === "fulfilled"
          ? result.value
          : unavailableFamily(kind, sourceSlug, result.reason);
      });
      try {
        const result: ResolvedCrossSurfaceLinks = {
          sourceSlug,
          links: families.flatMap((family) => family.links),
          readiness: families.map(
            (family): LinkFamilyReadiness => family.readiness,
          ),
        };
        setState({ state: "ready", result });
      } catch (error) {
        setState({ state: "error", message: safeClientError(error) });
      }
    });
    return () => {
      active = false;
    };
  }, [
    platformProjectId,
    projectVersionId,
    revision,
    rpc,
    sourceSlug,
    workspaceProjectId,
  ]);

  return { state, retry };
}

function bytesToBase64Url(value: string): string {
  if (value.length > 512) {
    throw new Error(
      "SBOM component route keys may contain at most 512 characters.",
    );
  }
  let binary = "";
  for (const byte of new TextEncoder().encode(value)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function useInspectorPortalTarget(): HTMLElement | null {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const locate = () => {
      const candidate = document.querySelector(
        '[aria-label="Architecture inspector"]',
      );
      setTarget(candidate instanceof HTMLElement ? candidate : null);
    };
    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return target;
}

interface ConfiguredLinksLayerProps {
  appRuntime: CanvasLinksAppRuntime;
  layoutProjectId: string | null;
  workspaceProjectId: string | null;
  platformProjectId: string | null;
  projectVersionId: string | null;
}

function ConfiguredLinksLayer({
  appRuntime,
  layoutProjectId,
  workspaceProjectId,
  platformProjectId,
  projectVersionId,
}: ConfiguredLinksLayerProps): React.JSX.Element | null {
  const architecture = useOptionalArchitectureSelection();
  if (!architecture) return null;
  return (
    <ArchitectureLinksLayer
      appRuntime={appRuntime}
      architecture={architecture}
      layoutProjectId={layoutProjectId}
      workspaceProjectId={workspaceProjectId}
      platformProjectId={platformProjectId}
      projectVersionId={projectVersionId}
    />
  );
}

function ArchitectureLinksLayer({
  appRuntime,
  architecture,
  layoutProjectId,
  workspaceProjectId,
  platformProjectId,
  projectVersionId,
}: ConfiguredLinksLayerProps & {
  architecture: ArchitectureSelectionContextValue;
}): React.JSX.Element | null {
  const navigate = appRuntime.useBbNavigate();
  const portalTarget = useInspectorPortalTarget();
  const selectedIds =
    architecture.selectedIds.length > 0
      ? architecture.selectedIds
      : architecture.focusId
        ? [architecture.focusId]
        : [];
  const selectedSlug = selectedIds.length === 1 ? selectedIds[0] : null;
  const selectedNode = selectedSlug
    ? architecture.nodesBySlug.get(selectedSlug)
    : undefined;
  const sourceSlug =
    selectedNode?.kind === "component" ? selectedNode.slug : null;
  const links = useCrossSurfaceLinks(
    appRuntime,
    workspaceProjectId,
    platformProjectId,
    projectVersionId,
    sourceSlug,
  );

  const onNavigate = useCallback(
    (link: CrossSurfaceLink) => {
      if (!link.ready) return;
      if (link.kind === "sbom") {
        navigate.toPluginPanel("bom", {
          subPath: `software/${bytesToBase64Url(link.target)}`,
        });
      } else if (link.kind === "firmware") {
        navigate.toPluginPanel("firmware", {
          subPath: `tree/${encodeURIComponent(link.target)}`,
        });
      } else if (link.kind === "requirement") {
        navigate.toPluginPanel("product-security", {
          subPath: `requirements/trace/${encodeURIComponent(link.target)}`,
        });
      } else {
        const segments = link.target
          .split("/")
          .map((segment) => encodeURIComponent(segment));
        navigate.toPluginPanel("product-security", {
          subPath: `verifications/${segments.join("/")}`,
        });
      }
    },
    [navigate],
  );

  const onSafeAction = useCallback(
    (
      kind: CrossSurfaceLinkKind,
      reason: "not_pulled" | "not_mapped" | "unavailable",
    ) => {
      if (reason === "not_pulled") {
        if (kind === "sbom") {
          navigate.toPluginPanel("bom", { subPath: "software" });
        } else if (kind === "firmware") {
          navigate.toPluginPanel("firmware");
        } else {
          navigate.toPluginPanel("product-security", {
            subPath: kind === "requirement" ? "requirements" : "verifications",
          });
        }
        return;
      }
      navigate.toCompose({
        initialPrompt:
          reason === "not_mapped"
            ? `Create the safe ${kind} mapping for architecture component ${sourceSlug ?? "the selected component"}.`
            : `Check why the ${kind} surface is unavailable for architecture component ${sourceSlug ?? "the selected component"}.`,
        focusPrompt: true,
      });
    },
    [navigate, sourceSlug],
  );

  if (!portalTarget || !workspaceProjectId || !layoutProjectId) return null;
  return createPortal(
    <>
      {sourceSlug ? (
        <CrossSurfaceLinks
          onNavigate={onNavigate}
          onRetry={links.retry}
          onSafeAction={onSafeAction}
          value={links.state}
        />
      ) : null}
      <CanvasLayoutPersistence
        appRuntime={appRuntime}
        projectId={layoutProjectId}
      />
    </>,
    portalTarget,
  );
}

export interface ProductSecurityLinksLayerProps {
  appRuntime?: CanvasLinksAppRuntime;
  scope?: ResolvedTaraScope;
  projectId?: string | null;
  projectVersionId?: string | null;
}

export const productSecurityEdgeTypes: EdgeTypes = {};

export function ProductSecurityLinksLayer({
  appRuntime: injectedRuntime,
  scope,
  projectId: injectedProjectId,
  projectVersionId: injectedProjectVersionId = null,
}: ProductSecurityLinksLayerProps = {}): React.JSX.Element | null {
  const workspaceProjectId = useMemo(
    () =>
      scope?.workspaceProjectId ??
      injectedProjectId ??
      readPersistedProjectId(),
    [injectedProjectId, scope?.workspaceProjectId],
  );
  const platformProjectId =
    scope?.mode === "version" ? scope.platformProjectId : null;
  const projectVersionId = scope?.projectVersionId ?? injectedProjectVersionId;
  const layoutProjectId = workspaceProjectId;
  const [loadedRuntime, setLoadedRuntime] =
    useState<CanvasLinksAppRuntime | null>(null);
  const [runtimeFailed, setRuntimeFailed] = useState(false);
  useEffect(() => {
    if (injectedRuntime) return;
    let active = true;
    void loadAppRuntime().then(
      (runtime) => {
        if (active) setLoadedRuntime(runtime);
      },
      () => {
        if (active) setRuntimeFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [injectedRuntime]);
  const appRuntime = injectedRuntime ?? loadedRuntime;
  if ((!injectedRuntime && runtimeFailed) || !appRuntime) return null;
  return (
    <ConfiguredLinksLayer
      appRuntime={appRuntime}
      layoutProjectId={layoutProjectId}
      workspaceProjectId={workspaceProjectId}
      platformProjectId={platformProjectId}
      projectVersionId={projectVersionId}
    />
  );
}
