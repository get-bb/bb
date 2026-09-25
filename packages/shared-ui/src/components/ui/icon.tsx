import {
  Component,
  createContext,
  useContext,
  type CSSProperties,
  type ReactNode,
} from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import Alert02Icon from "@hugeicons/core-free-icons/Alert02Icon";
import AlertCircleIcon from "@hugeicons/core-free-icons/AlertCircleIcon";
import Archive03Icon from "@hugeicons/core-free-icons/Archive03Icon";
import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import BotIcon from "@hugeicons/core-free-icons/BotIcon";
import BubbleChatAddIcon from "@hugeicons/core-free-icons/BubbleChatAddIcon";
import BubbleChatIcon from "@hugeicons/core-free-icons/BubbleChatIcon";
import Bug01Icon from "@hugeicons/core-free-icons/Bug01Icon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import CancelCircleIcon from "@hugeicons/core-free-icons/CancelCircleIcon";
import CheckListIcon from "@hugeicons/core-free-icons/CheckListIcon";
import CheckmarkCircle02Icon from "@hugeicons/core-free-icons/CheckmarkCircle02Icon";
import CircleIcon from "@hugeicons/core-free-icons/CircleIcon";
import ComputerTerminal01Icon from "@hugeicons/core-free-icons/ComputerTerminal01Icon";
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon";
import DashedLineCircleIcon from "@hugeicons/core-free-icons/DashedLineCircleIcon";
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import Download01Icon from "@hugeicons/core-free-icons/Download01Icon";
import Edit02Icon from "@hugeicons/core-free-icons/Edit02Icon";
import FilterHorizontalIcon from "@hugeicons/core-free-icons/FilterHorizontalIcon";
import FilterIcon from "@hugeicons/core-free-icons/FilterIcon";
import FolderAddIcon from "@hugeicons/core-free-icons/FolderAddIcon";
import FolderExportIcon from "@hugeicons/core-free-icons/FolderExportIcon";
import FolderGitTwoIcon from "@hugeicons/core-free-icons/FolderGit2Icon";
import Folder02Icon from "@hugeicons/core-free-icons/Folder02Icon";
import FolderIcon from "@hugeicons/core-free-icons/Folder01Icon";
import FolderSyncIcon from "@hugeicons/core-free-icons/FolderSyncIcon";
import FolderUnknownIcon from "@hugeicons/core-free-icons/FolderUnknownIcon";
import HelpCircleIcon from "@hugeicons/core-free-icons/HelpCircleIcon";
import InformationCircleIcon from "@hugeicons/core-free-icons/InformationCircleIcon";
import Loading03Icon from "@hugeicons/core-free-icons/Loading03Icon";
import MessageQuestionIcon from "@hugeicons/core-free-icons/MessageQuestionIcon";
import MoreHorizontalIcon from "@hugeicons/core-free-icons/MoreHorizontalIcon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import Settings01Icon from "@hugeicons/core-free-icons/Settings01Icon";
import SidebarLeftIcon from "@hugeicons/core-free-icons/SidebarLeftIcon";
import SlidersHorizontalIcon from "@hugeicons/core-free-icons/SlidersHorizontalIcon";
import SourceCodeIcon from "@hugeicons/core-free-icons/SourceCodeIcon";
import Target02Icon from "@hugeicons/core-free-icons/Target02Icon";
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon";
import ToolboxIcon from "@hugeicons/core-free-icons/ToolboxIcon";
import ToolCaseIcon from "@hugeicons/core-free-icons/ToolCaseIcon";
import UserAdd01Icon from "@hugeicons/core-free-icons/UserAdd01Icon";
import UnavailableIcon from "@hugeicons/core-free-icons/UnavailableIcon";
import WorkflowCircle03Icon from "@hugeicons/core-free-icons/WorkflowCircle03Icon";
import ZapIcon from "@hugeicons/core-free-icons/ZapIcon";
import { useSyncExternalStore } from "react";
import { cn } from "../../lib/utils";
import {
  EXTENDED_ICON_NAMES,
  getAppIcon,
  getPluginAssetIcon,
  subscribeAppIcons,
  subscribePluginAssetIcons,
  type ExtendedIconName,
  getExtendedIcons,
  subscribeExtendedIcons,
} from "./icon-registry";

const SectionAddStrokeRoundedIcon: IconSvgElement = [
  [
    "path",
    {
      d: "M2 3.4C2 2.24173 2.24173 2 3.4 2H20.6C21.7583 2 22 2.24173 22 3.4V4.6C22 5.75827 21.7583 6 20.6 6H3.4C2.24173 6 2 5.75827 2 4.6V3.4Z",
      stroke: "currentColor",
      strokeLinecap: "round",
      strokeWidth: "1.5",
      key: "0",
    },
  ],
  [
    "path",
    {
      d: "M2 11.4C2 10.2417 2.24173 10 3.4 10H10.6C11.7583 10 12 10.2417 12 11.4V12.6C12 13.7583 11.7583 14 10.6 14H3.4C2.24173 14 2 13.7583 2 12.6V11.4Z",
      stroke: "currentColor",
      strokeLinecap: "round",
      strokeWidth: "1.5",
      key: "1",
    },
  ],
  [
    "path",
    {
      d: "M2 19.4C2 18.2417 2.24173 18 3.4 18H10.6C11.7583 18 12 18.2417 12 19.4V20.6C12 21.7583 11.7583 22 10.6 22H3.4C2.24173 22 2 21.7583 2 20.6V19.4Z",
      stroke: "currentColor",
      strokeLinecap: "round",
      strokeWidth: "1.5",
      key: "2",
    },
  ],
  [
    "path",
    {
      d: "M18 13V21M22 17H14",
      stroke: "currentColor",
      strokeLinecap: "round",
      strokeWidth: "1.5",
      key: "3",
    },
  ],
];

const SectionMoveStrokeRoundedIcon: IconSvgElement = [
  [
    "path",
    {
      d: "M2 3.4C2 2.24173 2.24173 2 3.4 2H20.6C21.7583 2 22 2.24173 22 3.4V4.6C22 5.75827 21.7583 6 20.6 6H3.4C2.24173 6 2 5.75827 2 4.6V3.4Z",
      stroke: "currentColor",
      strokeLinecap: "round",
      strokeWidth: "1.5",
      key: "0",
    },
  ],
  [
    "path",
    {
      d: "M2 11.4C2 10.2417 2.24173 10 3.4 10H10.6C11.7583 10 12 10.2417 12 11.4V12.6C12 13.7583 11.7583 14 10.6 14H3.4C2.24173 14 2 13.7583 2 12.6V11.4Z",
      stroke: "currentColor",
      strokeLinecap: "round",
      strokeWidth: "1.5",
      key: "1",
    },
  ],
  [
    "path",
    {
      d: "M2 19.4C2 18.2417 2.24173 18 3.4 18H10.6C11.7583 18 12 18.2417 12 19.4V20.6C12 21.7583 11.7583 22 10.6 22H3.4C2.24173 22 2 21.7583 2 20.6V19.4Z",
      stroke: "currentColor",
      strokeLinecap: "round",
      strokeWidth: "1.5",
      key: "2",
    },
  ],
  [
    "path",
    {
      d: "M14 17H22M19 14L22 17L19 20",
      stroke: "currentColor",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeWidth: "1.5",
      key: "3",
    },
  ],
];

const CORE_ICON_MAP = {
  AlertCircle: AlertCircleIcon,
  AlertTriangle: Alert02Icon,
  Archive: Archive03Icon,
  Bot: BotIcon,
  Bug: Bug01Icon,
  Check: Tick02Icon,
  ChevronDown: ArrowDown01Icon,
  ChevronLeft: ArrowLeft01Icon,
  ChevronRight: ArrowRight01Icon,
  Circle: CircleIcon,
  CircleCheck: CheckmarkCircle02Icon,
  CircleQuestion: HelpCircleIcon,
  CircleX: CancelCircleIcon,
  ClosePluginPane: Cancel01Icon,
  CloseThreadPane: Cancel01Icon,
  Code: SourceCodeIcon,
  ComputerTerminal01: ComputerTerminal01Icon,
  Copy: Copy01Icon,
  Download: Download01Icon,
  Edit: Edit02Icon,
  Filter: FilterIcon,
  FilterHorizontal: FilterHorizontalIcon,
  Folder: FolderIcon,
  FolderExport: FolderExportIcon,
  FolderGit: FolderGitTwoIcon,
  FolderPlus: FolderAddIcon,
  FolderSync: FolderSyncIcon,
  FolderUnknown: FolderUnknownIcon,
  Folder02: Folder02Icon,
  Info: InformationCircleIcon,
  ListTodo: CheckListIcon,
  Loading: Loading03Icon,
  MessageQuestion: MessageQuestionIcon,
  MessageCirclePlus: BubbleChatAddIcon,
  MessageSquarePlus: BubbleChatAddIcon,
  MessageSquare: BubbleChatIcon,
  MoreHorizontal: MoreHorizontalIcon,
  PanelLeft: SidebarLeftIcon,
  Search: Search01Icon,
  SectionAdd: SectionAddStrokeRoundedIcon,
  SectionMove: SectionMoveStrokeRoundedIcon,
  Settings: Settings01Icon,
  SlidersHorizontal: SlidersHorizontalIcon,
  Spinner: DashedLineCircleIcon,
  Target: Target02Icon,
  Terminal: ComputerTerminal01Icon,
  Toolbox: ToolboxIcon,
  ToolCase: ToolCaseIcon,
  Trash2: Delete02Icon,
  Unavailable: UnavailableIcon,
  UserRoundPlus: UserAdd01Icon,
  Workflow: WorkflowCircle03Icon,
  X: Cancel01Icon,
  Zap: ZapIcon,
} as const satisfies Record<string, IconSvgElement>;

type CoreIconName = keyof typeof CORE_ICON_MAP;

export type BuiltinIconName = CoreIconName | ExtendedIconName;
export type IconName = string;

const CORE_ICON_NAMES = Object.keys(CORE_ICON_MAP) as readonly CoreIconName[];

export const ICON_NAMES: readonly BuiltinIconName[] = [
  ...CORE_ICON_NAMES,
  ...EXTENDED_ICON_NAMES,
];

const CORE_ICON_LOOKUP: Readonly<Record<string, IconSvgElement | undefined>> =
  CORE_ICON_MAP;

let extendedIconsLoad: Promise<void> | null = null;

export function preloadExtendedIcons(): Promise<void> {
  if (getExtendedIcons() !== null) return Promise.resolve();
  extendedIconsLoad ??= import("./icon-extended").then(
    () => undefined,
    (error: unknown) => {
      extendedIconsLoad = null;
      throw error;
    },
  );
  return extendedIconsLoad;
}

const EMPTY_ICON: IconSvgElement = [];

export interface IconProps {
  name: IconName;
  fallback?: string;
  className?: string;
  style?: CSSProperties;
  "aria-hidden"?: boolean | "true" | "false";
  "aria-label"?: string;
}

const ICON_NAME_SET: ReadonlySet<string> = new Set(ICON_NAMES);
const IconAncestors = createContext<readonly string[]>([]);

export function isBuiltinIconName(name: string): name is BuiltinIconName {
  return ICON_NAME_SET.has(name);
}

class IconErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function Icon({ name, fallback = "Zap", ...props }: IconProps) {
  const ancestors = useContext(IconAncestors);
  const custom = useSyncExternalStore(
    subscribeAppIcons,
    () => getAppIcon(name),
    () => getAppIcon(name),
  );
  const fallbackCustom = useSyncExternalStore(
    subscribeAppIcons,
    () => getAppIcon(fallback),
    () => getAppIcon(fallback),
  );
  const asset = useSyncExternalStore(
    subscribePluginAssetIcons,
    () => getPluginAssetIcon(name),
    () => getPluginAssetIcon(name),
  );
  const fallbackAsset = useSyncExternalStore(
    subscribePluginAssetIcons,
    () => getPluginAssetIcon(fallback),
    () => getPluginAssetIcon(fallback),
  );
  const requestedExists =
    custom !== undefined || isBuiltinIconName(name) || asset !== undefined;
  const resolved = requestedExists ? name : fallback;
  const definition = requestedExists ? custom : fallbackCustom;
  const resolvedAsset = requestedExists ? asset : fallbackAsset;
  const CustomIcon = definition?.component;
  if (ancestors.includes(resolved)) {
    return (
      <BuiltinIcon
        name={isBuiltinIconName(resolved) ? resolved : "Zap"}
        {...props}
      />
    );
  }
  if (CustomIcon !== undefined && definition !== undefined) {
    return (
      <IconAncestors.Provider value={[...ancestors, resolved]}>
        <IconErrorBoundary
          key={definition.key}
          fallback={<BuiltinIcon name="Zap" {...props} />}
        >
          <span
            className={cn("inline-flex size-6 shrink-0", props.className)}
            style={props.style}
            aria-hidden={props["aria-hidden"]}
            aria-label={props["aria-label"]}
            role={props["aria-label"] ? "img" : undefined}
            data-icon={resolved}
            data-icon-root=""
          >
            <CustomIcon className="size-full" />
          </span>
        </IconErrorBoundary>
      </IconAncestors.Provider>
    );
  }
  if (CustomIcon === undefined && resolvedAsset !== undefined) {
    return (
      <PluginAssetIcon url={resolvedAsset} resolved={resolved} {...props} />
    );
  }
  return (
    <BuiltinIcon
      name={isBuiltinIconName(resolved) ? resolved : "Zap"}
      {...props}
    />
  );
}

function PluginAssetIcon({
  url,
  resolved,
  className,
  style,
  "aria-hidden": ariaHidden,
  "aria-label": ariaLabel,
}: Omit<IconProps, "name" | "fallback"> & {
  url: string;
  resolved: string;
}) {
  const image = `url("${url.replace(/["\\]/gu, "\\$&")}")`;
  return (
    <span
      className={cn("inline-block size-6 shrink-0", className)}
      style={{
        ...style,
        backgroundColor: "currentColor",
        maskImage: image,
        maskPosition: "center",
        maskRepeat: "no-repeat",
        maskSize: "contain",
        WebkitMaskImage: image,
        WebkitMaskPosition: "center",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
      }}
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
      data-icon={resolved}
      data-icon-root=""
      data-plugin-icon-asset={url}
    />
  );
}

function BuiltinIcon({
  name,
  className,
  style,
  "aria-hidden": ariaHidden,
  "aria-label": ariaLabel,
}: IconProps) {
  const coreIcon = CORE_ICON_LOOKUP[name];
  if (coreIcon !== undefined) {
    return (
      <HugeiconsIcon
        icon={coreIcon}
        className={cn(className)}
        style={style}
        aria-hidden={ariaHidden}
        aria-label={ariaLabel}
        data-icon={name}
        data-icon-root=""
      />
    );
  }
  return (
    <ExtendedIcon
      name={name}
      className={className}
      style={style}
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
    />
  );
}

function ExtendedIcon({
  name,
  className,
  style,
  "aria-hidden": ariaHidden,
  "aria-label": ariaLabel,
}: IconProps) {
  const extendedIcons: Readonly<
    Record<string, IconSvgElement | undefined>
  > | null = useSyncExternalStore(
    subscribeExtendedIcons,
    getExtendedIcons,
    getExtendedIcons,
  );
  const icon = extendedIcons?.[name];
  if (icon === undefined) {
    void preloadExtendedIcons().catch(() => undefined);
  }
  return (
    <HugeiconsIcon
      icon={icon ?? EMPTY_ICON}
      className={cn(className)}
      style={style}
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
      data-icon={name}
      data-icon-root=""
      data-icon-pending={icon === undefined ? "" : undefined}
    />
  );
}
