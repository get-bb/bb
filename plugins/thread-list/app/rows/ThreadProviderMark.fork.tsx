// bb-fork(windows): fork-local sidebar decoration; the provider mark and the model line under a thread title.
import { useMemo, type MouseEvent } from "react";
import {
  experimental_ProviderIcon as ProviderIcon,
  experimental_useProviders,
  type PluginProvidersState,
} from "@get-bb/plugin-sdk/app";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type ThreadProvider = PluginProvidersState["providers"][number];

export const SIDEBAR_MODEL_ROW_HEIGHT_CLASS =
  "min-h-[var(--bb-sidebar-row-height)] max-md:pointer-coarse:min-h-[var(--bb-sidebar-row-height-coarse)]";

const providerByIdCache = new WeakMap<
  PluginProvidersState["providers"],
  ReadonlyMap<string, ThreadProvider>
>();

function providerById(
  providers: PluginProvidersState["providers"],
): ReadonlyMap<string, ThreadProvider> {
  const cached = providerByIdCache.get(providers);
  if (cached !== undefined) return cached;
  const map = new Map(
    providers.map((provider) => [provider.id, provider] as const),
  );
  providerByIdCache.set(providers, map);
  return map;
}

export function useThreadProvider(providerId: string): ThreadProvider | null {
  const { providers } = experimental_useProviders();
  return useMemo(
    () => providerById(providers).get(providerId) ?? null,
    [providers, providerId],
  );
}

function shortModelLabel(model: string): string {
  const separator = model.lastIndexOf("/");
  return separator === -1 ? model : model.slice(separator + 1);
}

export function ThreadProviderMark({
  provider,
  onActivate,
}: {
  provider: ThreadProvider | null;
  onActivate: () => void;
}) {
  const handleClick = (event: MouseEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onActivate();
  };
  if (provider === null) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-sidebar-thread-provider=""
          className="relative z-10 flex shrink-0 pointer-events-auto items-center text-subtle-foreground"
          onClick={handleClick}
        >
          <ProviderIcon
            providerKind="agent"
            provider={provider}
            className="size-3.5"
            aria-label={provider.displayName}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{provider.displayName}</TooltipContent>
    </Tooltip>
  );
}

export function ThreadModelLabel({
  model,
}: {
  model: string | null | undefined;
}) {
  if (model == null) return null;
  return (
    <span
      data-sidebar-thread-model=""
      className="max-w-full truncate text-xs leading-none text-subtle-foreground"
    >
      {shortModelLabel(model)}
    </span>
  );
}
