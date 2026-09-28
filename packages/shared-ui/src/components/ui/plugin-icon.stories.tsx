import { PluginBrandIcon, PluginCompactIconMask } from "./plugin-icon.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/PluginIcon",
};

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
          iconUrl="https://example.com/icon.svg"
          iconTinted
          className="size-4"
        />
      </StoryRow>
      <StoryRow
        label="Compact mask icon"
        hint="plugins/theme-preview/app.tsx — compact CSS-mask icon inline in a label row"
      >
        <PluginCompactIconMask url="https://example.com/icon.svg" className="size-4" />
      </StoryRow>
    </StoryCard>
  );
}
