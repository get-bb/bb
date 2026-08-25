import type { CSSProperties } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { BotIcon } from "@hugeicons/core-free-icons";
import type { CommentProvider } from "../../shared/contract.js";

const AVATAR_LAYOUT_CLASS =
  "z-[1] mt-px flex size-[22px] shrink-0 items-center justify-center";
const PROVIDER_AVATAR_CLASS = `${AVATAR_LAYOUT_CLASS} rounded-full border border-border bg-secondary text-foreground`;
const FALLBACK_AVATAR_CLASS = `${AVATAR_LAYOUT_CLASS} rounded-full bg-primary text-primary-foreground outline outline-2 outline-background`;

/**
 * A served provider logo as a CSS mask filled with `currentColor`, the way
 * the app draws the same assets: an SVG in an `<img>` is a separate document
 * where `currentColor` is black, so the logo is the mask's alpha and takes
 * the chip's text color in light and dark. Core vendors no brand marks; the
 * logo is the one the provider's plugin declared.
 */
function providerLogoMaskStyle(logoUrl: string): CSSProperties {
  const image = `url("${logoUrl.replace(/["\\]/gu, "\\$&")}")`;
  return {
    maskImage: image,
    WebkitMaskImage: image,
    maskRepeat: "no-repeat",
    WebkitMaskRepeat: "no-repeat",
    maskPosition: "center",
    WebkitMaskPosition: "center",
    maskSize: "contain",
    WebkitMaskSize: "contain",
  };
}

/** Renders the provider's served logo in a subtle chip (one fetch per mark). */
function ProviderLogoImage({
  provider,
  logoUrl,
}: {
  provider: CommentProvider;
  logoUrl: string;
}) {
  return (
    <span
      role="img"
      aria-label={provider.name}
      className={PROVIDER_AVATAR_CLASS}
    >
      <span
        aria-hidden
        data-provider-logo={logoUrl}
        className="size-4 bg-current"
        style={providerLogoMaskStyle(logoUrl)}
      />
    </span>
  );
}

/**
 * The generic bot avatar for a provider with no served logo and for an
 * unresolved provider. Keeps the stronger legacy avatar
 * chip so it remains recognizable as a fallback. SDK-free so it renders in a
 * plain jsdom test.
 */
function GenericAgentAvatar({ name }: { name: string }) {
  return (
    <span role="img" aria-label={name} className={FALLBACK_AVATAR_CLASS}>
      <HugeiconsIcon icon={BotIcon} className="size-3.5" aria-hidden />
    </span>
  );
}

/**
 * Avatar for an agent-authored comment: the responding agent's provider logo.
 * `provider` is null for legacy agent comments with no resolvable thread and
 * for threads that are deleted/hidden/inaccessible — those show the generic
 * agent glyph, matching the previous behavior.
 */
export function CommentProviderAvatar({
  provider,
}: {
  provider: CommentProvider | null;
}) {
  if (provider?.logoUrl != null) {
    return <ProviderLogoImage provider={provider} logoUrl={provider.logoUrl} />;
  }
  return <GenericAgentAvatar name={provider?.name ?? "Agent"} />;
}
