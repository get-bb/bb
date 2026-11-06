import { useId, useState } from "react";
import type { ExperimentalCollapsibleStackCardProps } from "@get-bb/plugin-sdk";
import { pluginIconName } from "@/components/plugin/PluginIcon";
import { CollapsibleActiveStackCard } from "@/components/promptbox/banner/CollapsibleActiveStackCard";
import { showMutationErrorToast } from "@/lib/mutation-errors";

export function CollapsibleStackCard({
  label,
  title,
  icon,
  isActive,
  dismiss,
  children,
}: ExperimentalCollapsibleStackCardProps) {
  const id = useId();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDismissPending, setIsDismissPending] = useState(false);
  return (
    <CollapsibleActiveStackCard
      cardAriaLabel={label}
      controlsAriaLabel={`${label} controls`}
      toggleId={`${id}-toggle`}
      bodyId={`${id}-body`}
      toggleAriaLabel={label}
      iconName={pluginIconName(icon)}
      title={title}
      isActive={isActive}
      isExpanded={isExpanded}
      onToggle={() => setIsExpanded((value) => !value)}
      dismiss={
        dismiss === undefined
          ? null
          : {
              ariaLabel: dismiss.label,
              isPending: isDismissPending,
              onDismiss: () => {
                setIsDismissPending(true);
                dismiss
                  .onDismiss()
                  .catch((error: unknown) => {
                    showMutationErrorToast({
                      error,
                      fallbackMessage: dismiss.failureMessage,
                    });
                  })
                  .finally(() => setIsDismissPending(false));
              },
            }
      }
    >
      {children}
    </CollapsibleActiveStackCard>
  );
}
