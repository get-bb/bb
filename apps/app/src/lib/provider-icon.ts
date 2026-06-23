import {
  getBuiltInAgentProviderInfo,
  isAcpProviderId,
  isAgentProviderId,
} from "@bb/agent-providers";
import type { ComponentType } from "react";
import { createElement } from "react";
import { ClaudeIcon } from "@/components/icons/ClaudeIcon";
import { CursorIcon } from "@/components/icons/CursorIcon";
import { OpenAiIcon } from "@/components/icons/OpenAiIcon";
import { OpencodeIcon } from "@/components/icons/OpencodeIcon";
import { PiIcon } from "@/components/icons/PiIcon";
import { Icon } from "@/components/ui/icon";

const ACP_ID_PREFIX = "acp-";

interface ProviderIconInfo {
  icon: ComponentType<{ className?: string }>;
  ariaLabel: string;
}

const GenericAcpIcon: ComponentType<{ className?: string }> = ({
  className,
}) => createElement(Icon, { name: "Code", className, "aria-hidden": "true" });

// Brand icons for well-known ACP agents, keyed by slug (the provider id with
// the `acp-` prefix stripped). Unknown ACP agents fall back to the generic
// glyph; the display name still comes from the server-provided ProviderInfo.
const KNOWN_ACP_BRAND_ICONS: Record<
  string,
  ComponentType<{ className?: string }>
> = {
  opencode: OpencodeIcon,
};

/**
 * Maps closed_internal provider IDs to their brand icon components.
 * Returns undefined for unknown providers so callers can fall back gracefully.
 */
export function getProviderIconInfo(
  providerId: string,
): ProviderIconInfo | undefined {
  if (!isAgentProviderId(providerId) && isAcpProviderId(providerId)) {
    const slug = providerId.slice(ACP_ID_PREFIX.length);
    const brandIcon = KNOWN_ACP_BRAND_ICONS[slug];
    return {
      icon: brandIcon ?? GenericAcpIcon,
      ariaLabel: brandIcon ? slug : "ACP provider",
    };
  }

  const providerInfo = isAgentProviderId(providerId)
    ? getBuiltInAgentProviderInfo(providerId)
    : null;
  if (!providerInfo) {
    return undefined;
  }

  switch (providerId) {
    case "codex":
      return {
        icon: OpenAiIcon,
        ariaLabel: providerInfo.displayName,
      };
    case "claude-code":
      return {
        icon: ClaudeIcon,
        ariaLabel: providerInfo.displayName,
      };
    case "pi":
      return {
        icon: PiIcon,
        ariaLabel: providerInfo.displayName,
      };
    case "acp-cursor":
      return {
        icon: CursorIcon,
        ariaLabel: providerInfo.displayName,
      };
    default:
      return undefined;
  }
}
