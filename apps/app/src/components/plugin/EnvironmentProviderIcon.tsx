import type { SystemEnvironmentProvider } from "@bb/server-contract";
import { ProviderIcon } from "./ProviderIcon";

export function EnvironmentProviderIcon({
  provider,
  className,
}: {
  provider: SystemEnvironmentProvider;
  className?: string;
}) {
  return (
    <ProviderIcon
      providerId={provider.id}
      logoUrl={provider.logoUrl}
      glyph={provider.icon}
      fallback="Zap"
      className={className}
    />
  );
}
