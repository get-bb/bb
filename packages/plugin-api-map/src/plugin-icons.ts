/**
 * The map's icons: the shipped bb plugins named in each surface's "Used by"
 * list, and the capability glyph each pixel-less surface is drawn with.
 *
 * Both come from the plugin's own package.json — `bb.branding.icon` resolved
 * through the same hugeicons set the app's icon registry uses, and the plugin
 * id that `/extensions/plugins/<id>` routes to. Provider plugins brand with
 * bundled SVG files the docs cannot import, so they share one provider glyph.
 */
import {
  ArrowDataTransferHorizontalIcon,
  ArrowReloadHorizontalIcon,
  BrainIcon,
  BrowserIcon,
  CheckListIcon,
  Clock01Icon,
  Coffee01Icon,
  ComputerIcon,
  DatabaseIcon,
  Edit04Icon,
  File01Icon,
  GithubIcon,
  Layers01Icon,
  LockIcon,
  MessageAdd02Icon,
  MessageQuestionIcon,
  SmartPhone01Icon,
  SourceCodeIcon,
  SparklesIcon,
  TerminalIcon,
  TestTubeIcon,
  WorkflowCircle03Icon,
  Activity03Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";

interface FirstPartyPlugin {
  /** Installed plugin id; the last segment of its page URL. */
  id: string;
  icon: IconSvgElement;
}

/** Keyed by the display name surfaces.ts lists in `firstParty`. */
const FIRST_PARTY_PLUGINS: Record<string, FirstPartyPlugin> = {
  "Ask User Question": { id: "ask-user-question", icon: MessageQuestionIcon },
  Automations: { id: "automations", icon: Clock01Icon },
  "Custom instructions": { id: "custom-instructions", icon: Edit04Icon },
  // Installed as `simple-notes` (its manifest source is `builtin:docs`), so
  // the id and the builtin slug differ; the page URL uses the id.
  Docs: { id: "simple-notes", icon: File01Icon },
  GitHub: { id: "github", icon: GithubIcon },
  "Inline visualizations": { id: "inline-vis", icon: BrowserIcon },
  "Keep Awake": { id: "keep-awake", icon: Coffee01Icon },
  Memory: { id: "memory", icon: BrainIcon },
  "Provider retry": { id: "provider-retry", icon: ArrowReloadHorizontalIcon },
  "Remote access": { id: "connect", icon: SmartPhone01Icon },
  Secrets: { id: "secrets", icon: LockIcon },
  "Side chat": { id: "side-chat", icon: MessageAdd02Icon },
  Tasks: { id: "tasks", icon: CheckListIcon },
  Workflows: { id: "workflows", icon: WorkflowCircle03Icon },
  "ACP providers": { id: "provider-acp", icon: SparklesIcon },
  "Claude Code provider": { id: "provider-claude-code", icon: SparklesIcon },
  "Codex provider": { id: "provider-codex", icon: SparklesIcon },
  "Pi provider": { id: "provider-pi", icon: SparklesIcon },
};

export function pluginIcon(displayName: string): IconSvgElement | null {
  return FIRST_PARTY_PLUGINS[displayName]?.icon ?? null;
}

/**
 * The installed-plugin id bb knows this plugin by, or null when the name is
 * not one of the shipped plugins.
 *
 * Deliberately NOT turned into a URL here. A plugin only has a page when the
 * running bb actually knows it (installed, or present in that host's
 * catalog), so whether to link is a question only the host can answer; see
 * `pluginPageHref` on ProductMap. Matching is by id rather than display name
 * because a plugin's display name is not its id: bb's own Docs plugin is
 * installed as `simple-notes`, and two catalog entries can share a name.
 */
export function firstPartyPluginId(displayName: string): string | null {
  return FIRST_PARTY_PLUGINS[displayName]?.id ?? null;
}

/**
 * The capability glyph for a pixel-less surface, or null for one a fixture
 * draws (those are identified by their numbered marker instead).
 *
 * One definition, two readers: the capability card on the "Plugin backend"
 * slide and the detail card that card opens.
 */
const SURFACE_ICONS: Record<string, IconSvgElement> = {
  cli: TerminalIcon,
  "agent-tools": SparklesIcon,
  background: Clock01Icon,
  // Two opposing arrows, not the "{api}" glyph: that one is dense text
  // in a box and unreadable at card size on a large monitor.
  wire: ArrowDataTransferHorizontalIcon,
  storage: DatabaseIcon,
  // An activity line, not a bolt: the bolt is the app's skills glyph.
  "thread-events": Activity03Icon,
  "host-workers": ComputerIcon,
  "bb-sdk": SourceCodeIcon,
  "host-components": Layers01Icon,
  testing: TestTubeIcon,
};

export function surfaceIcon(surfaceId: string): IconSvgElement | null {
  return SURFACE_ICONS[surfaceId] ?? null;
}
