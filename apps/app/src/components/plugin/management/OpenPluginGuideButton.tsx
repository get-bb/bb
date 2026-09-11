import { Icon } from "@bb/shared-ui/icon";
import { buttonVariants } from "@bb/shared-ui/button";
import { cn } from "@bb/shared-ui/lib/utils";

export function OpenPluginGuideButton({
  variant = "ghost",
}: {
  variant?: "ghost" | "outline";
}) {
  return (
    <a
      href="/plugins/plugin-api-docs/plugin-api"
      target="_blank"
      rel="noreferrer"
      className={cn(
        buttonVariants({ variant, size: "sm" }),
        "group/guide shrink-0 gap-1.5",
        variant === "ghost" && "text-muted-foreground",
      )}
    >
      <span className="relative size-4">
        <Icon name="Explore" className="size-4" aria-hidden />
        <Icon
          name="Pin"
          className="absolute -right-1 -top-1 size-3 opacity-0 transition-opacity group-hover/guide:opacity-100 group-focus-visible/guide:opacity-100"
          aria-hidden
        />
      </span>
      Plugin Guide
      <Icon name="ExternalLink" className="size-3.5" aria-hidden />
      <span className="sr-only">Opens in a new tab</span>
    </a>
  );
}
