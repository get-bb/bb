import type { ReactNode } from "react";
import {
  ResourceActivitySection,
  ResourceDefinitionSection,
  ResourceDetailConfigurationSection,
  ResourceDetailIncludesSection,
  ResourceDetailOverviewSection,
  ResourceDetailPage,
  ResourceDetailReleaseSection,
  ResourceDetailStack,
  ResourceOverflowMenu,
  ResourceProperty,
  ResourcePropertyList,
  type ResourceOverflowMenuItem,
} from "@bb/shared-ui/resource-list";
import { Switch } from "@bb/shared-ui/switch";

export interface PluginDetailProperty {
  label: ReactNode;
  value: ReactNode;
}

export interface PluginDetailSection {
  label: ReactNode;
  content: ReactNode;
  kind?: "definition" | "configuration" | "release" | "includes";
}

function PluginDefinitionSection({
  section,
}: {
  section: PluginDetailSection;
}) {
  const props = { label: section.label, children: section.content };
  if (section.kind === "configuration") {
    return <ResourceDetailConfigurationSection {...props} />;
  }
  if (section.kind === "release") {
    return <ResourceDetailReleaseSection {...props} />;
  }
  if (section.kind === "includes") {
    return <ResourceDetailIncludesSection {...props} />;
  }
  return <ResourceDefinitionSection {...props} />;
}

export function PluginDetailView({
  leading,
  title,
  titleMeta,
  metadata,
  description,
  enabled,
  lifecycleDisabled = false,
  onEnabledChange,
  overflowItems,
  properties = [],
  definitionSections = [],
  activitySections = [],
}: {
  leading: ReactNode;
  title: string;
  titleMeta?: ReactNode;
  metadata: ReactNode;
  description?: ReactNode;
  enabled?: boolean;
  lifecycleDisabled?: boolean;
  onEnabledChange?: (enabled: boolean) => void;
  overflowItems?: readonly ResourceOverflowMenuItem[];
  properties?: readonly PluginDetailProperty[];
  definitionSections?: readonly PluginDetailSection[];
  activitySections?: readonly PluginDetailSection[];
}) {
  const hasLifecycleControl =
    enabled !== undefined && onEnabledChange !== undefined;
  const hasDescription =
    description !== undefined &&
    description !== null &&
    description !== false &&
    description !== "";
  return (
    <ResourceDetailPage
      leading={leading}
      title={title}
      titleMeta={titleMeta}
      metadata={metadata}
      lifecycleControl={
        hasLifecycleControl ? (
          <Switch
            checked={enabled}
            disabled={lifecycleDisabled}
            aria-label={`${enabled ? "Disable" : "Enable"} ${title}`}
            onCheckedChange={onEnabledChange}
          />
        ) : undefined
      }
      overflowMenu={
        overflowItems && overflowItems.length > 0 ? (
          <ResourceOverflowMenu
            label={`${title} actions`}
            items={overflowItems}
          />
        ) : undefined
      }
    >
      {hasDescription ||
      properties.length > 0 ||
      definitionSections.length > 0 ||
      activitySections.length > 0 ? (
        <ResourceDetailStack>
          {hasDescription ? (
            <ResourceDetailOverviewSection label="About">
              <p className="text-sm leading-relaxed text-foreground">
                {description}
              </p>
            </ResourceDetailOverviewSection>
          ) : null}
          {properties.length > 0 ? (
            <ResourceDetailConfigurationSection label="Configuration">
              <ResourcePropertyList
                surface="recessed"
                className="divide-y divide-border"
              >
                {properties.map((property, index) => (
                  <ResourceProperty key={index} label={property.label}>
                    {property.value}
                  </ResourceProperty>
                ))}
              </ResourcePropertyList>
            </ResourceDetailConfigurationSection>
          ) : null}
          {definitionSections.map((section, index) => (
            <PluginDefinitionSection key={index} section={section} />
          ))}
          {activitySections.map((section, index) => (
            <ResourceActivitySection key={index} label={section.label}>
              {section.content}
            </ResourceActivitySection>
          ))}
        </ResourceDetailStack>
      ) : null}
    </ResourceDetailPage>
  );
}
