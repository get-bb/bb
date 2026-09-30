import type { ReactNode } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { SettingsWithControl } from "@/components/ui/settings-section";

export interface ChoiceDropdownOption {
  key: string;
  title: string;
  description: string;
  disabled?: boolean;
}

export function ChoiceDropdownSetting({
  label,
  description,
  triggerAriaLabel,
  options,
  selected,
  onSelect,
  disabled = false,
  children,
}: {
  label: string;
  description: ReactNode;
  triggerAriaLabel: string;
  options: readonly ChoiceDropdownOption[];
  selected: Pick<ChoiceDropdownOption, "key" | "title">;
  onSelect: (key: string) => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <SettingsWithControl label={label} description={description}>
      <div className="flex shrink-0 items-center gap-2">
        {children}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="min-w-40 justify-between"
              aria-label={triggerAriaLabel}
              disabled={disabled}
            >
              <span className="min-w-0 truncate">{selected.title}</span>
              <Icon
                name="ChevronDown"
                className="size-3.5 text-muted-foreground"
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            {options.map((option) => (
              <DropdownMenuItem
                key={option.key}
                disabled={option.disabled}
                onSelect={() => onSelect(option.key)}
                className="flex items-start gap-2"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{option.title}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {option.description}
                  </span>
                </span>
                <Icon
                  name="Check"
                  className={cn(
                    "ml-auto mt-0.5",
                    selected.key !== option.key && "opacity-0",
                    COARSE_POINTER_ICON_SIZE_CLASS,
                  )}
                />
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </SettingsWithControl>
  );
}
