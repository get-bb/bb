import type { ThreadChatProps } from "@get-bb/plugin-sdk";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { cn } from "@bb/shared-ui/lib/utils";
import { defineSplit } from "@/lib/define-split";

export const LazyPluginThreadChat = defineSplit<ThreadChatProps>({
  id: "plugin-thread-chat",
  tier: "intent",
  load: () =>
    import("./PluginThreadChat").then((module) => module.PluginThreadChat),
  loading: ({ className, layout = "contained" }) => (
    <div
      className={cn(
        "flex min-h-0 flex-col",
        layout === "contained" && "h-full",
        className,
      )}
      aria-label="Loading conversation"
      aria-busy="true"
    >
      <Skeleton className="m-4 h-4 w-40" />
      <Skeleton className="m-4 h-4 w-56" />
    </div>
  ),
});
