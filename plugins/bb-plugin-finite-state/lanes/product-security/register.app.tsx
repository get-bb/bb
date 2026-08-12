import type { PluginAppBuilder, PluginNavPanelProps } from "@bb/plugin-sdk/app";
import type { AppContext } from "../../lib/app-context.js";
import { ProductSecurityEditingLayer } from "./canvas/editing/index.js";
import {
  ProductSecurityLinksLayer,
  productSecurityEdgeTypes,
} from "./canvas/links/index.js";
import { loadProductSecurityNodeTypes } from "./canvas/nodes/index.js";
import { ProductSecurityThreatOverlay } from "./canvas/threat-overlay/index.js";
import { RequirementsCards } from "./requirements/cards/index.js";
import { RequirementsConversionLayer } from "./requirements/conversion/index.js";
import { RequirementsTraceabilityLayer } from "./requirements/traceability/index.js";
import { ProductSecurityHeader } from "./ui/ProductSecurityHeader.js";
import {
  ProductSecurityPanel,
  type ProductSecurityFeatures,
} from "./ui/ProductSecurityPanel.js";
import { VerificationMatrix } from "./verifications/matrix/index.js";
import { VerificationRunDetailLayer } from "./verifications/run-detail/index.js";

const features: ProductSecurityFeatures = {
  loadNodeTypes: loadProductSecurityNodeTypes,
  edgeTypes: productSecurityEdgeTypes,
  ThreatOverlay: ProductSecurityThreatOverlay,
  LinksLayer: ProductSecurityLinksLayer,
  EditingLayer: ProductSecurityEditingLayer,
  RequirementsCards,
  RequirementsTraceabilityLayer,
  RequirementsConversionLayer,
  VerificationMatrix,
  VerificationRunDetailLayer,
};

function ProductSecurityPanelSlot(
  props: PluginNavPanelProps,
): React.JSX.Element {
  return <ProductSecurityPanel {...props} features={features} />;
}

export function registerProductSecurityApp(
  app: PluginAppBuilder,
  _ctx: AppContext,
): void {
  app.slots.navPanel({
    id: "product-security",
    title: "Product Security",
    icon: "Shield",
    path: "product-security",
    component: ProductSecurityPanelSlot,
    headerContent: ProductSecurityHeader,
  });
}
