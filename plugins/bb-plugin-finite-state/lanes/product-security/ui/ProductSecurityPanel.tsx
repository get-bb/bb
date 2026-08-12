import { lazy, Suspense, useMemo, type ComponentType } from "react";
import type { NodeTypes } from "@xyflow/react";
import {
  useBbContext,
  useBbNavigate,
  type PluginNavPanelProps,
} from "@bb/plugin-sdk/app";
import type { CanvasFoundationFeatures } from "../canvas/foundation/CanvasShell.js";
import { useCanvasData } from "../canvas/foundation/useCanvasData.js";
import type { CanvasModel } from "../canvas/foundation/types.js";
import {
  parseProductSecurityRoute,
  PRODUCT_SECURITY_TABS,
  productSecuritySubPath,
  type ProductSecurityTab,
} from "./route.js";
import {
  CanvasCacheBanner,
  CanvasEmptyState,
  CanvasErrorState,
  CanvasLoadingState,
  CanvasUnconfiguredState,
} from "./states.js";

export interface ProductSecurityFeatures extends Omit<
  CanvasFoundationFeatures,
  "nodeTypes"
> {
  loadNodeTypes(): Promise<NodeTypes>;
  RequirementsCards: ComponentType;
  RequirementsTraceabilityLayer: ComponentType;
  RequirementsConversionLayer: ComponentType;
  VerificationMatrix: ComponentType;
  VerificationRunDetailLayer: ComponentType;
}

interface ProductSecurityPanelProps extends PluginNavPanelProps {
  features: ProductSecurityFeatures;
}

function TaraPanel({
  features,
}: {
  features: ProductSecurityFeatures;
}): React.JSX.Element {
  const { projectId } = useBbContext();
  const data = useCanvasData(projectId);
  const LazyCanvasShell = useMemo(
    () =>
      lazy(async () => {
        const [module, nodeTypes] = await Promise.all([
          import("../canvas/foundation/CanvasShell.js"),
          features.loadNodeTypes(),
        ]);
        const LoadedCanvasShell = module.default;
        return {
          default({ model }: { model: CanvasModel }): React.JSX.Element {
            return (
              <LoadedCanvasShell
                features={{
                  nodeTypes,
                  edgeTypes: features.edgeTypes,
                  ThreatOverlay: features.ThreatOverlay,
                  LinksLayer: features.LinksLayer,
                  EditingLayer: features.EditingLayer,
                }}
                model={model}
              />
            );
          },
        };
      }),
    [features],
  );

  if (data.status === "unconfigured") return <CanvasUnconfiguredState />;
  if (data.status === "loading") return <CanvasLoadingState />;
  if (data.status === "error" || !data.model) {
    return <CanvasErrorState onRetry={data.retry} />;
  }
  if (data.model.nodes.length === 0) {
    return <CanvasEmptyState onRetry={data.retry} />;
  }

  const model: CanvasModel = data.error
    ? { ...data.model, cache: { ...data.model.cache, stale: true } }
    : data.model;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <CanvasCacheBanner
        error={data.error}
        pulledAt={model.cache.pulledAt}
        stale={model.cache.stale}
      />
      <div className="min-h-0 flex-1">
        <Suspense fallback={<CanvasLoadingState />}>
          <LazyCanvasShell model={model} />
        </Suspense>
      </div>
    </div>
  );
}

const TAB_LABELS: Record<ProductSecurityTab, string> = {
  tara: "TARA",
  requirements: "Requirements",
  verifications: "Verifications",
};

export function ProductSecurityPanel({
  subPath,
  features,
}: ProductSecurityPanelProps): React.JSX.Element {
  const navigate = useBbNavigate();
  const route = parseProductSecurityRoute(subPath);
  const RequirementsCards = features.RequirementsCards;
  const RequirementsTraceabilityLayer = features.RequirementsTraceabilityLayer;
  const RequirementsConversionLayer = features.RequirementsConversionLayer;
  const VerificationMatrix = features.VerificationMatrix;
  const VerificationRunDetailLayer = features.VerificationRunDetailLayer;
  return (
    <main className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <nav
        aria-label="Product Security sections"
        className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2"
      >
        {PRODUCT_SECURITY_TABS.map((tab) => (
          <button
            aria-current={route.tab === tab ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              route.tab === tab
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
            key={tab}
            onClick={() =>
              navigate.toPluginPanel("product-security", {
                subPath: productSecuritySubPath(tab),
              })
            }
            type="button"
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1">
        {route.tab === "tara" ? <TaraPanel features={features} /> : null}
        {route.tab === "requirements" ? (
          <>
            <RequirementsCards />
            <RequirementsTraceabilityLayer />
            <RequirementsConversionLayer />
          </>
        ) : null}
        {route.tab === "verifications" ? (
          <>
            <VerificationMatrix />
            <VerificationRunDetailLayer />
          </>
        ) : null}
      </div>
    </main>
  );
}
