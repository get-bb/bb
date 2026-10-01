import { firstPartyPluginId } from "../../../../plugins/plugin-api-docs/src/plugin-icons";
import { ProductMap } from "../../../../plugins/plugin-api-docs/src/product-map";

function marketplaceHref(displayName: string): string | null {
  const id = firstPartyPluginId(displayName);
  return id === null ? null : `/marketplace/${encodeURIComponent(id)}`;
}

export default function PluginGuide({
  initialSlideId,
  onSlideChange,
}: {
  initialSlideId?: string;
  onSlideChange?: (slideId: string) => void;
}) {
  return (
    <ProductMap
      pluginPageHref={marketplaceHref}
      initialSlideId={initialSlideId}
      onSlideChange={onSlideChange}
    />
  );
}
