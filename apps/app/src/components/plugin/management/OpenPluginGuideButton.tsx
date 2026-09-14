import { Icon } from "@bb/shared-ui/icon";
import { buttonVariants } from "@bb/shared-ui/button";
import { cn } from "@bb/shared-ui/lib/utils";

export function OpenPluginGuideButton() {
  return (
    <a
      href="/plugins/plugin-api-docs/plugin-api"
      target="_blank"
      rel="noreferrer"
      aria-label="Plugin Guide (opens in a new tab)"
      className={cn(
        buttonVariants({ variant: "link", size: "sm" }),
        "shrink-0 gap-1.5 px-0 text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon name="Explore" className="size-4" aria-hidden />
      <span className="underline underline-offset-4">Plugin Guide</span>
      <Icon name="ExternalLink" className="size-3.5" aria-hidden />
    </a>
  );
}
