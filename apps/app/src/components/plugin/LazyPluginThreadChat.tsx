import type { ThreadChatProps } from "@get-bb/plugin-sdk";
import { cn } from "@bb/shared-ui/lib/utils";
import { defineSplit } from "@/lib/define-split";
import { ThreadChatLoadingBody } from "@/components/thread/timeline/ThreadChatLoading";

export const LazyPluginThreadChat = defineSplit<ThreadChatProps>({
  id: "plugin-thread-chat",
  tier: "intent",
  load: () =>
    import("./PluginThreadChat").then((module) => module.PluginThreadChat),
  loading: ({
    className,
    layout = "contained",
    leadingContent,
    variant = "full",
  }) => (
    <div
      className={cn(
        layout === "contained" ? "flex h-full min-h-0 flex-col" : "flex flex-col",
        className,
      )}
      aria-busy="true"
    >
      <ThreadChatLoadingBody leadingContent={leadingContent} variant={variant} />
    </div>
  ),
});
