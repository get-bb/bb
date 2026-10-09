import { Fragment } from "react";
import type { ThreadTimelineSessionOption } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { LIST_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  OPTION_BASE_CLASS_NAME,
  OPTION_INTERACTIVE_CLASS_NAME,
  OPTION_MENU_CONTENT_CLASS_NAME,
  OPTION_MUTED_CLASS_NAME,
  OPTION_TRIGGER_CONTENT_CLASS_NAME,
} from "@bb/shared-ui/option-display";

const SESSION_OPTIONS_MENU_LABEL = "Agent options";
const SESSION_OPTION_MODE_CATEGORY = "mode";

export type SessionOptionChoice = string | boolean;
export type SessionOptionChoices = Readonly<
  Record<string, SessionOptionChoice>
>;

interface SessionOptionMenuItem {
  key: string;
  label: string;
  description: string | null;
  value: SessionOptionChoice;
  selected: boolean;
}

export interface SessionOptionMenuSection {
  id: string;
  label: string;
  description: string | null;
  category: string | null;
  appliesOnNextTurn: boolean;
  selectedLabel: string;
  items: SessionOptionMenuItem[];
}

export function buildSessionOptionMenuSections(
  options: readonly ThreadTimelineSessionOption[],
  choices: SessionOptionChoices,
): SessionOptionMenuSection[] {
  return options.map((option) => {
    const chosen = Object.hasOwn(choices, option.id)
      ? choices[option.id]
      : undefined;
    const effective = chosen ?? option.pendingValue ?? option.value;
    const items: SessionOptionMenuItem[] =
      option.type === "boolean"
        ? [
            { key: "true", label: "On", description: null, value: true },
            { key: "false", label: "Off", description: null, value: false },
          ].map((item) => ({ ...item, selected: item.value === effective }))
        : option.values.map((value) => ({
            key: value.id,
            label: value.label,
            description: value.description,
            value: value.id,
            selected: value.id === effective,
          }));
    return {
      id: option.id,
      label: option.label,
      description: option.description,
      category: option.category,
      appliesOnNextTurn: effective !== option.value,
      selectedLabel:
        items.find((item) => item.selected)?.label ?? String(effective),
      items,
    };
  });
}

export function sessionOptionsTriggerLabel(
  sections: readonly SessionOptionMenuSection[],
): string {
  const mode = sections.find(
    (section) => section.category === SESSION_OPTION_MODE_CATEGORY,
  );
  if (mode !== undefined) {
    return mode.selectedLabel;
  }
  const only = sections.length === 1 ? sections[0] : undefined;
  return only === undefined
    ? "Options"
    : `${only.label}: ${only.selectedLabel}`;
}

interface SessionOptionsMenuProps {
  options: readonly ThreadTimelineSessionOption[];
  choices: SessionOptionChoices;
  onChange: (optionId: string, value: SessionOptionChoice) => void;
  disabled?: boolean;
}

export function SessionOptionsMenu({
  options,
  choices,
  onChange,
  disabled,
}: SessionOptionsMenuProps) {
  if (options.length === 0) {
    return null;
  }
  const sections = buildSessionOptionMenuSections(options, choices);
  const triggerLabel = sessionOptionsTriggerLabel(sections);
  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={SESSION_OPTIONS_MENU_LABEL}
      disabled={disabled}
      className={cn(
        OPTION_BASE_CLASS_NAME,
        OPTION_INTERACTIVE_CLASS_NAME,
        LIST_HOVER_TRANSITION,
        OPTION_MUTED_CLASS_NAME,
        disabled && "cursor-default disabled:opacity-100",
      )}
    >
      <span
        className={OPTION_TRIGGER_CONTENT_CLASS_NAME}
        title={sections
          .map((section) => `${section.label}: ${section.selectedLabel}`)
          .join(", ")}
      >
        <span className="min-w-0 truncate">{triggerLabel}</span>
      </span>
      {disabled ? null : (
        <Icon
          name="ChevronDown"
          className="size-3.5 shrink-0 text-subtle-foreground/75"
        />
      )}
    </Button>
  );
  if (disabled) {
    return trigger;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className={OPTION_MENU_CONTENT_CLASS_NAME}
        mobileTitle={SESSION_OPTIONS_MENU_LABEL}
      >
        {sections.map((section) => (
          <Fragment key={section.id}>
            <DropdownMenuLabel title={section.description ?? undefined}>
              {section.label}
              {section.appliesOnNextTurn ? (
                <span className="ml-1.5 font-normal text-muted-foreground">
                  from the next turn
                </span>
              ) : null}
            </DropdownMenuLabel>
            {section.items.map((item) => (
              <DropdownMenuItem
                key={item.key}
                onSelect={() => onChange(section.id, item.value)}
                className={cn(
                  "flex items-start justify-between gap-3 whitespace-normal",
                  LIST_HOVER_TRANSITION,
                )}
              >
                <span className="min-w-0 flex-1">
                  <span
                    className="block whitespace-normal break-words font-medium"
                    title={item.label}
                  >
                    {item.label}
                  </span>
                  {item.description ? (
                    <span className="mt-0.5 block whitespace-normal break-words text-xs leading-snug text-muted-foreground">
                      {item.description}
                    </span>
                  ) : null}
                </span>
                <Icon
                  name="Check"
                  className={cn(
                    COARSE_POINTER_ICON_SIZE_CLASS,
                    "shrink-0",
                    item.selected ? "opacity-100" : "opacity-0",
                  )}
                />
              </DropdownMenuItem>
            ))}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
