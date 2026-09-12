import {
  experimental_Icon as Icon,
  experimental_ProviderIcon as ProviderIcon,
} from "@get-bb/plugin-sdk/app";
import type { CommentProvider } from "../../shared/contract.js";

const AVATAR_LAYOUT_CLASS =
  "z-[1] mt-px flex size-[22px] shrink-0 items-center justify-center";
const PROVIDER_AVATAR_CLASS = `${AVATAR_LAYOUT_CLASS} rounded-full border border-border bg-secondary text-foreground`;
const FALLBACK_AVATAR_CLASS = `${AVATAR_LAYOUT_CLASS} rounded-full bg-primary text-primary-foreground outline outline-2 outline-background`;

export function CommentProviderAvatar({
  provider,
}: {
  provider: CommentProvider | null;
}) {
  const hasArtwork = provider?.logoUrl != null || provider?.icon != null;
  return (
    <span
      role="img"
      aria-label={provider?.name ?? "Agent"}
      className={hasArtwork ? PROVIDER_AVATAR_CLASS : FALLBACK_AVATAR_CLASS}
    >
      {provider === null ? (
        <Icon name="Bot" className="size-3.5" aria-hidden="true" />
      ) : (
        <ProviderIcon
          providerKind="agent"
          provider={provider}
          fallback="Bot"
          className={hasArtwork ? "size-4" : "size-3.5"}
        />
      )}
    </span>
  );
}
