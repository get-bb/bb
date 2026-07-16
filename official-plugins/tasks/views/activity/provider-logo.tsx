import type { ComponentType } from "react";
import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { BotIcon } from "@hugeicons/core-free-icons";
import type { CommentProvider } from "../../shared/contract.js";
import {
  ClaudeIcon,
  CursorIcon,
  GrokIcon,
  OmpIcon,
  OpenAiIcon,
  OpencodeIcon,
  PiIcon,
} from "./provider-icons.js";
import { HermesAgentIcon } from "./provider-hermes-icon.js";

/**
 * Brand glyphs for well-known built-in and ACP providers, keyed by the live
 * `providerId`. Mirrors the app's canonical mapping in
 * `apps/app/src/lib/provider-icon.ts`. Providers absent here (or whose brand
 * mark is not vendored) fall back to the generic bot glyph — the byline still
 * names the provider for screen readers.
 */
const BRAND_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  codex: OpenAiIcon,
  "claude-code": ClaudeIcon,
  pi: PiIcon,
  "acp-cursor": CursorIcon,
  "acp-grok": GrokIcon,
  "acp-hermes-agent": HermesAgentIcon,
  "acp-opencode": OpencodeIcon,
  "acp-omp": OmpIcon,
};

const AVATAR_LAYOUT_CLASS =
  "z-[1] mt-px flex size-[22px] shrink-0 items-center justify-center";
const FALLBACK_AVATAR_CLASS = `${AVATAR_LAYOUT_CLASS} rounded-full bg-primary text-primary-foreground outline outline-2 outline-background`;

/**
 * Renders a served provider logo (custom ACP agents expose a `logoUrl`) without
 * an avatar chip, matching provider marks in the model picker. Falls back to
 * the brand glyph / bot avatar if the image fails to load.
 */
function ProviderLogoImage({ provider }: { provider: CommentProvider }) {
  const [failed, setFailed] = useState(false);
  if (failed || provider.logoUrl === null) {
    return <ProviderBrandAvatar provider={provider} />;
  }
  return (
    <span role="img" aria-label={provider.name} className={AVATAR_LAYOUT_CLASS}>
      <img
        src={provider.logoUrl}
        alt=""
        aria-hidden
        className="size-4 object-contain"
        onError={() => setFailed(true)}
      />
    </span>
  );
}

/**
 * Known provider marks render bare, like the model picker. The generic bot for
 * unknown/unavailable providers keeps the legacy avatar chip so it remains
 * recognizable as a fallback. Kept SDK-free so it renders in a plain jsdom
 * test.
 */
function ProviderBrandAvatar({
  provider,
}: {
  provider: CommentProvider | null;
}) {
  const Brand = provider ? BRAND_ICONS[provider.id] : undefined;
  if (Brand) {
    return (
      <span
        role="img"
        aria-label={provider?.name ?? "Agent"}
        className={`${AVATAR_LAYOUT_CLASS} text-foreground`}
      >
        <Brand className="size-4" />
      </span>
    );
  }
  return (
    <span
      role="img"
      aria-label={provider?.name ?? "Agent"}
      className={FALLBACK_AVATAR_CLASS}
    >
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
    return <ProviderLogoImage provider={provider} />;
  }
  return <ProviderBrandAvatar provider={provider} />;
}
