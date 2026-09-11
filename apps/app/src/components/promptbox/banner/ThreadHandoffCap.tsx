import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import type { ProviderPickerOption } from "@/components/pickers/model-brand-prefix";

interface ThreadHandoffCapProps {
  modelLabel: string;
  onCancel: () => void;
  providerIcon: ProviderPickerOption["icon"];
  providerLabel: string;
}

export function ThreadHandoffCap({
  modelLabel,
  onCancel,
  providerIcon: ProviderIcon,
  providerLabel,
}: ThreadHandoffCapProps) {
  return (
    <PromptStackCard
      ariaLabel="Handoff to new thread"
      className="relative z-10 -mb-5 rounded-xl rounded-b-none border-b-0 bg-surface-raised-solid pb-3 shadow-lift"
    >
      <div className="flex h-8 items-center gap-1.5 px-3 text-xs">
        {ProviderIcon ? (
          <ProviderIcon className="size-3.5 shrink-0" />
        ) : (
          <Icon
            name="MessageSquarePlus"
            className="size-3.5 shrink-0 text-subtle-foreground"
            aria-hidden
          />
        )}
        <span className="min-w-0 truncate">
          <span className="font-medium text-foreground">New thread</span>
          <span className="text-subtle-foreground">
            {" "}
            with {providerLabel} · {modelLabel} when you submit
          </span>
        </span>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="ml-auto size-6 shrink-0 text-subtle-foreground"
          onClick={onCancel}
          aria-label="Cancel handoff"
        >
          <Icon name="X" className="size-3" aria-hidden />
        </Button>
      </div>
    </PromptStackCard>
  );
}
