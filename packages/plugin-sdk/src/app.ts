import type { PluginSdkApp } from "./app-contract.js";

export type * from "./app-contract.js";

/**
 * `@bb/plugin-sdk/app` — typed facade over the BB app's plugin runtime.
 *
 * This module's runtime is never bundled into plugins: `bb plugin build`
 * swaps the specifier for a shim reading
 * `globalThis.__bbPluginRuntime.pluginSdkApp` (which the BB app fills with
 * its real implementation before importing any plugin bundle). The re-export
 * below mirrors that shim so code importing this package directly (plugin
 * unit tests, tooling) resolves the same objects when a runtime is
 * installed — and `undefined` values, not a module-load throw, when none is.
 *
 * The UI kit half of the surface is the host's shadcn/ui-derived components
 * under stock shadcn names/props — standard shadcn code works unchanged.
 */

interface PluginRuntimeHost {
  __bbPluginRuntime?: { pluginSdkApp?: unknown };
}

// The global is the genuinely unknowable boundary here: the host app
// guarantees the shape via its own `satisfies PluginSdkApp` check.
const runtime = ((globalThis as PluginRuntimeHost).__bbPluginRuntime
  ?.pluginSdkApp ?? {}) as Partial<PluginSdkApp> as PluginSdkApp;

export const definePluginApp = runtime.definePluginApp;
export const useRpc = runtime.useRpc;
export const useRealtime = runtime.useRealtime;
export const useSettings = runtime.useSettings;
export const useBbContext = runtime.useBbContext;
export const useBbNavigate = runtime.useBbNavigate;
export const toast = runtime.toast;

// shadcn/ui surface.
export const Badge = runtime.Badge;
export const Button = runtime.Button;
export const Card = runtime.Card;
export const CardContent = runtime.CardContent;
export const CardDescription = runtime.CardDescription;
export const CardFooter = runtime.CardFooter;
export const CardHeader = runtime.CardHeader;
export const CardTitle = runtime.CardTitle;
export const Checkbox = runtime.Checkbox;
export const Dialog = runtime.Dialog;
export const DialogClose = runtime.DialogClose;
export const DialogContent = runtime.DialogContent;
export const DialogDescription = runtime.DialogDescription;
export const DialogFooter = runtime.DialogFooter;
export const DialogHeader = runtime.DialogHeader;
export const DialogOverlay = runtime.DialogOverlay;
export const DialogTitle = runtime.DialogTitle;
export const DialogTrigger = runtime.DialogTrigger;
export const DropdownMenu = runtime.DropdownMenu;
export const DropdownMenuCheckboxItem = runtime.DropdownMenuCheckboxItem;
export const DropdownMenuContent = runtime.DropdownMenuContent;
export const DropdownMenuGroup = runtime.DropdownMenuGroup;
export const DropdownMenuItem = runtime.DropdownMenuItem;
export const DropdownMenuLabel = runtime.DropdownMenuLabel;
export const DropdownMenuPortal = runtime.DropdownMenuPortal;
export const DropdownMenuRadioGroup = runtime.DropdownMenuRadioGroup;
export const DropdownMenuRadioItem = runtime.DropdownMenuRadioItem;
export const DropdownMenuSeparator = runtime.DropdownMenuSeparator;
export const DropdownMenuShortcut = runtime.DropdownMenuShortcut;
export const DropdownMenuSub = runtime.DropdownMenuSub;
export const DropdownMenuSubContent = runtime.DropdownMenuSubContent;
export const DropdownMenuSubTrigger = runtime.DropdownMenuSubTrigger;
export const DropdownMenuTrigger = runtime.DropdownMenuTrigger;
export const Input = runtime.Input;
export const Label = runtime.Label;
export const Popover = runtime.Popover;
export const PopoverAnchor = runtime.PopoverAnchor;
export const PopoverContent = runtime.PopoverContent;
export const PopoverTrigger = runtime.PopoverTrigger;
export const Select = runtime.Select;
export const SelectContent = runtime.SelectContent;
export const SelectGroup = runtime.SelectGroup;
export const SelectItem = runtime.SelectItem;
export const SelectLabel = runtime.SelectLabel;
export const SelectScrollDownButton = runtime.SelectScrollDownButton;
export const SelectScrollUpButton = runtime.SelectScrollUpButton;
export const SelectSeparator = runtime.SelectSeparator;
export const SelectTrigger = runtime.SelectTrigger;
export const SelectValue = runtime.SelectValue;
export const Separator = runtime.Separator;
export const Skeleton = runtime.Skeleton;
export const Switch = runtime.Switch;
export const Tabs = runtime.Tabs;
export const TabsContent = runtime.TabsContent;
export const TabsList = runtime.TabsList;
export const TabsTrigger = runtime.TabsTrigger;
export const Textarea = runtime.Textarea;
export const Tooltip = runtime.Tooltip;
export const TooltipContent = runtime.TooltipContent;
export const TooltipProvider = runtime.TooltipProvider;
export const TooltipTrigger = runtime.TooltipTrigger;

// BB extras (not shadcn).
export const EmptyState = runtime.EmptyState;
export const Markdown = runtime.Markdown;
export const PageBody = runtime.PageBody;
export const Spinner = runtime.Spinner;
