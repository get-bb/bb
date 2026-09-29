import { PluginBrandIcon, PluginCompactIconMask } from "./plugin-icon.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/PluginIcon",
};

const ICON_DATA_URI =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='currentColor'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3C/svg%3E";

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="Brand icon lookup"
        hint="plugins/plugin-api-docs/app.tsx — brand icon falling back through icon/iconUrl/tinted variants"
      >
        <PluginBrandIcon icon="Github" iconUrl={null} iconTinted={false} className="size-4" />
        <PluginBrandIcon
          icon={null}
          iconUrl={ICON_DATA_URI}
          iconTinted
          className="size-4"
        />
        <PluginBrandIcon
          icon={null}
          iconUrl={ICON_DATA_URI}
          iconTinted={false}
          className="size-4"
        />
      </StoryRow>
      <StoryRow
        label="Compact mask icon"
        hint="plugins/theme-preview/app.tsx — compact CSS-mask icon inline in a label row"
      >
        <PluginCompactIconMask url={ICON_DATA_URI} className="size-4" />
      </StoryRow>
    </StoryCard>
  );
}
