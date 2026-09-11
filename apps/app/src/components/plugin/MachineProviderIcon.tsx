import { ProviderIcon } from "./ProviderIcon";

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
  return (
    <ProviderIcon
      providerKind="machine"
      provider={provider}
      fallback="Zap"
      className={className}
    />
  );
}
