import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowTurnBackwardIcon,
  ArrowUp01Icon,
  CancelCircleIcon,
  CheckListIcon,
  Clock01Icon,
  ComputerTerminal01Icon,
  Edit02Icon,
  HelpCircleIcon,
  Loading03Icon,
  Target02Icon,
  Tick02Icon,
  UserAdd01Icon,
  WorkflowCircle03Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "../lib/utils";

const ICON_MAP = {
  ArrowTurnBackward: ArrowTurnBackwardIcon,
  Check: Tick02Icon,
  ChevronDown: ArrowDown01Icon,
  ChevronLeft: ArrowLeft01Icon,
  ChevronUp: ArrowUp01Icon,
  CircleQuestion: HelpCircleIcon,
  CircleX: CancelCircleIcon,
  Clock: Clock01Icon,
  Edit: Edit02Icon,
  ListTodo: CheckListIcon,
  Loading: Loading03Icon,
  Target: Target02Icon,
  Terminal: ComputerTerminal01Icon,
  UserRoundPlus: UserAdd01Icon,
  Workflow: WorkflowCircle03Icon,
} as const satisfies Record<string, IconSvgElement>;

export type IconName = keyof typeof ICON_MAP;

export function Icon({
  name,
  className,
  "aria-hidden": ariaHidden,
  "aria-label": ariaLabel,
}: {
  name: IconName;
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
  "aria-label"?: string;
}) {
  return (
    <HugeiconsIcon
      icon={ICON_MAP[name]}
      className={cn(className)}
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
      data-icon={name}
    />
  );
}
