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
  ResourceInstalledControl,
  ResourceLifecycleStatus,
  ResourceOverflowMenu,
  ResourceProperty,
  ResourcePropertyList,
  type ResourceOverflowMenuItem,
} from "@bb/shared-ui/resource-list";
import type { IconName } from "@bb/shared-ui/icon";
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
  description,
  statusAlert,
  metadata,
  provenance,
  installed,
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
  description?: ReactNode;
  statusAlert?: ReactNode;
  metadata: ReactNode;
  provenance?: {
    label: ReactNode;
    tooltip?: ReactNode;
    accessibleLabel?: string;
    icon?: IconName;
    appearance?: "default" | "recessed";
  };
  installed?: {
    accessibleLabel: string;
    label?: string;
    icon?: IconName;
    appearance?: "installed" | "provenance";
    pending?: boolean;
    onAction: () => void;
  };
  enabled?: boolean;
  lifecycleDisabled?: boolean;
  onEnabledChange?: (enabled: boolean) => void;
  overflowItems?: readonly ResourceOverflowMenuItem[];
  properties?: readonly PluginDetailProperty[];
  definitionSections?: readonly PluginDetailSection[];
  activitySections?: readonly PluginDetailSection[];
}) {
  const hasRuntimeControl =
    enabled !== undefined && onEnabledChange !== undefined;
  return (
    <ResourceDetailPage
      leading={leading}
      title={title}
      metadata={metadata}
      lifecycleControl={
        installed || provenance || hasRuntimeControl ? (
          <div className="flex items-center gap-2">
            {installed ? (
              <ResourceInstalledControl
                accessibleLabel={installed.accessibleLabel}
                label={installed.label}
                icon={installed.icon}
                appearance={installed.appearance}
                pending={installed.pending}
                onAction={installed.onAction}
              />
            ) : null}
            {provenance ? (
              <ResourceLifecycleStatus
                label={provenance.label}
                tooltip={provenance.tooltip}
                accessibleLabel={provenance.accessibleLabel}
                icon={provenance.icon}
                appearance={provenance.appearance}
              />
            ) : null}
            {hasRuntimeControl ? (
              <Switch
                checked={enabled}
                disabled={lifecycleDisabled}
                aria-label={`${enabled ? "Disable" : "Enable"} ${title}`}
                onCheckedChange={onEnabledChange}
              />
            ) : null}
          </div>
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
      {statusAlert ||
      description ||
      properties.length > 0 ||
      definitionSections.length > 0 ||
      activitySections.length > 0 ? (
        <ResourceDetailStack>
          {statusAlert}
          {description ? (
            <ResourceDetailOverviewSection label="About">
              <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
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
