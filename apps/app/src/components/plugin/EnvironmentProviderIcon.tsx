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
      providerKind="environment"
      provider={provider}
      fallback="Zap"
      className={className}
    />
  );
}
