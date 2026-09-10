import { Icon } from "@bb/shared-ui/icon";
import { getProviderIconInfo } from "@/lib/provider-icon";
import { pluginIconName } from "./PluginIcon";

export interface MachineProviderPresentation {
  id: string;
  displayName: string;
  icon: string;
  logoUrl: string | null;
}

export function MachineProviderIcon({
  provider,
  className,
}: {
  provider: MachineProviderPresentation;
  className?: string;
}) {
  const info = getProviderIconInfo(provider.id, {
    logoUrl: provider.logoUrl,
    displayName: provider.displayName,
    icon: { glyph: provider.icon },
  });
  const ProviderIcon = info?.icon;
  return ProviderIcon === undefined ? (
    <Icon name={pluginIconName(provider.icon)} className={className} />
  ) : (
    <ProviderIcon className={className} />
  );
}
