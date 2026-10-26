import {
  useDiffRendererLoad,
  useSourceCodeRendererLoad,
} from "@/components/code/useCodeRendererLoad";
import type {
  DiffProps,
  MarkdownProps,
  SourceCodeProps,
} from "@get-bb/plugin-sdk";
import { defineSplit } from "@/lib/define-split";
import {
  DiffLoadingSkeleton,
  SourceLoadingSkeleton,
} from "@/components/code/code-loading-skeletons";

export const LazyPluginMarkdown = defineSplit<MarkdownProps>({
  id: "plugin-markdown",
  tier: "preload",
  load: () =>
    import("./PluginMarkdown").then((module) => module.PluginMarkdown),
  loading: ({ className }) => <div className={className} aria-busy="true" />,
});

const PluginDiffSplit = defineSplit<DiffProps>({
  id: "plugin-diff",
  tier: "preload",
  load: () => import("./PluginDiff").then((module) => module.PluginDiff),
  loading: () => <DiffLoadingSkeleton />,
});

const PluginSourceCodeSplit = defineSplit<SourceCodeProps>({
  id: "plugin-source-code",
  tier: "preload",
  load: () =>
    import("./PluginSourceCode").then((module) => module.PluginSourceCode),
  loading: () => <SourceLoadingSkeleton />,
});

export const LazyPluginDiff = Object.assign(function LazyPluginDiff(
  props: DiffProps,
) {
  useDiffRendererLoad();
  return <PluginDiffSplit {...props} />;
}, PluginDiffSplit);

export const LazyPluginSourceCode = Object.assign(function LazyPluginSourceCode(
  props: SourceCodeProps,
) {
  useSourceCodeRendererLoad();
  return <PluginSourceCodeSplit {...props} />;
}, PluginSourceCodeSplit);
