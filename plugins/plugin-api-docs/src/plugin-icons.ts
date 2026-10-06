import ArrowDataTransferHorizontalIcon from "@hugeicons/core-free-icons/ArrowDataTransferHorizontalIcon";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
import DatabaseIcon from "@hugeicons/core-free-icons/DatabaseIcon";
import Layers01Icon from "@hugeicons/core-free-icons/Layers01Icon";
import SourceCodeIcon from "@hugeicons/core-free-icons/SourceCodeIcon";
import SparklesIcon from "@hugeicons/core-free-icons/SparklesIcon";
import ComputerTerminal01Icon from "@hugeicons/core-free-icons/ComputerTerminal01Icon";
import TestTubeIcon from "@hugeicons/core-free-icons/TestTubeIcon";
import Activity03Icon from "@hugeicons/core-free-icons/Activity03Icon";
import type { IconSvgElement } from "@hugeicons/react";
import type { IconName } from "@/components/ui/icon";
import FIRST_PARTY_PLUGINS from "./first-party-plugins.json";

export function pluginIcon(displayName: string): IconName | null {
  return (
    FIRST_PARTY_PLUGINS.find((plugin) => plugin.name === displayName)?.icon ??
    null
  );
}

export function firstPartyPluginId(displayName: string): string | null {
  return (
    FIRST_PARTY_PLUGINS.find((plugin) => plugin.name === displayName)?.id ??
    null
  );
}

const SURFACE_ICONS: Record<string, IconSvgElement> = {
  cli: ComputerTerminal01Icon,
  "agent-tools": SparklesIcon,
  background: Clock01Icon,
  wire: ArrowDataTransferHorizontalIcon,
  storage: DatabaseIcon,
  "thread-events": Activity03Icon,
  "host-workers": ComputerIcon,
  "bb-sdk": SourceCodeIcon,
  "host-components": Layers01Icon,
  testing: TestTubeIcon,
};

export function surfaceIcon(surfaceId: string): IconSvgElement | null {
  return SURFACE_ICONS[surfaceId] ?? null;
}
