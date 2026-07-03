import type {
  PluginCardProps,
  PluginSdkApp,
  PluginSpinnerProps,
} from "@bb/plugin-sdk";
import { Button } from "@/components/ui/button.js";
import { EmptyState } from "@/components/ui/empty-state.js";
import { Icon } from "@/components/ui/icon.js";
import { MarkdownPreview } from "@/components/ui/markdown-preview.js";
import { cn } from "@/lib/utils";
import { definePluginApp } from "./plugin-app-definition";
import {
  useBbContext,
  useBbNavigate,
  useRealtime,
  useRpc,
  useSettings,
} from "./plugin-sdk-hooks";

/**
 * The real `@bb/plugin-sdk/app` surface (plugin design §5.2), assigned to
 * `globalThis.__bbPluginRuntime.pluginSdkApp` by installPluginRuntime() so
 * `bb plugin build` shims resolve it inside plugin bundles. `satisfies
 * PluginSdkApp` keeps it in type-sync with the facade package, and a unit
 * test asserts its keys equal PLUGIN_SDK_APP_EXPORT_NAMES (the shim's
 * named-export list).
 *
 * The UI kit is a curated adapter over existing app primitives — plugin
 * components render in the host DOM, so theme tokens apply for free. It
 * grows additively; internal app components are deliberately not exposed.
 */

function PluginCard({ title, className, children }: PluginCardProps) {
  return (
    <section
      className={cn(
        "rounded-lg border border-border bg-card px-4 py-3.5 text-sm text-foreground",
        className,
      )}
    >
      {title !== undefined && title.length > 0 ? (
        <h3 className="mb-2 text-sm font-semibold text-foreground">{title}</h3>
      ) : null}
      {children}
    </section>
  );
}

function PluginSpinner({ className }: PluginSpinnerProps) {
  return (
    <Icon
      name="Spinner"
      aria-hidden="true"
      className={cn("size-4 animate-spin", className)}
    />
  );
}

function PluginMarkdown({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return <MarkdownPreview content={content} className={className} />;
}

export const pluginSdkAppImplementation = {
  Button,
  Card: PluginCard,
  EmptyState,
  Markdown: PluginMarkdown,
  Spinner: PluginSpinner,
  definePluginApp,
  useBbContext,
  useBbNavigate,
  useRealtime,
  useRpc,
  useSettings,
} satisfies PluginSdkApp;
