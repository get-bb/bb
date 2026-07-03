import { useState } from "react";
import { toast } from "sonner";
import type {
  PluginPageBodyProps,
  PluginSdkApp,
  PluginSpinnerProps,
  PluginSwitchProps,
} from "@bb/plugin-sdk";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog.js";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { EmptyState } from "@/components/ui/empty-state.js";
import { Icon } from "@/components/ui/icon.js";
import { Input } from "@/components/ui/input.js";
import { Label } from "@/components/ui/label.js";
import { MarkdownPreview } from "@/components/ui/markdown-preview.js";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover.js";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { Separator } from "@/components/ui/separator.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { Switch } from "@/components/ui/switch.js";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs.js";
import { Textarea } from "@/components/ui/textarea.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip.js";
import { cn } from "@/lib/utils";
import { definePluginApp } from "./plugin-app-definition";
import {
  useBbContext,
  useBbNavigate,
  useRealtime,
  useRpc,
  useSettings,
} from "./plugin-sdk-hooks";

/**
 * The real `@bb/plugin-sdk/app` surface (plugin design §5.2), assigned to
 * `globalThis.__bbPluginRuntime.pluginSdkApp` by installPluginRuntime() so
 * `bb plugin build` shims resolve it inside plugin bundles. `satisfies
 * PluginSdkApp` keeps it in type-sync with the facade package, and a unit
 * test asserts its keys equal PLUGIN_SDK_APP_EXPORT_NAMES (the shim's
 * named-export list).
 *
 * The UI kit is the host's shadcn/ui-derived components under stock shadcn
 * names/props — models writing plugins can write standard shadcn code.
 * Plugin components render in the host DOM, so theme tokens and portalled
 * overlays work for free. The kit grows additively; internal app components
 * beyond this surface are deliberately not exposed.
 */

function PluginSpinner({ className }: PluginSpinnerProps) {
  return (
    <Icon
      name="Spinner"
      aria-hidden="true"
      className={cn("size-4 animate-spin", className)}
    />
  );
}

/**
 * Opt-in navPanel layout: `chrome: "page"` bodies are full-width, and this
 * wrapper restores the classic centered max-w-3xl column the host's own
 * settings-style pages use (the page chrome already supplies the top
 * padding). `space-y-4` gives the pre-chrome-change vertical rhythm;
 * override via className.
 */
function PluginPageBody({ className, children }: PluginPageBodyProps) {
  return (
    <div className={cn("mx-auto w-full max-w-3xl space-y-4", className)}>
      {children}
    </div>
  );
}

function PluginMarkdown({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return <MarkdownPreview content={content} className={className} />;
}

/**
 * The app's Switch is controlled-only; shadcn/radix Switch also supports
 * uncontrolled use (`defaultChecked`). Bridge the gap so stock shadcn code
 * works either way.
 */
function PluginSwitch({
  checked,
  defaultChecked = false,
  onCheckedChange,
  ...props
}: PluginSwitchProps) {
  const [uncontrolledChecked, setUncontrolledChecked] =
    useState(defaultChecked);
  const isControlled = checked !== undefined;
  return (
    <Switch
      {...props}
      checked={isControlled ? checked : uncontrolledChecked}
      onCheckedChange={(next) => {
        if (!isControlled) {
          setUncontrolledChecked(next);
        }
        onCheckedChange?.(next);
      }}
    />
  );
}

export const pluginSdkAppImplementation = {
  definePluginApp,
  useBbContext,
  useBbNavigate,
  useRealtime,
  useRpc,
  useSettings,
  toast,
  // shadcn/ui surface.
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Input,
  Label,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  Separator,
  Skeleton,
  Switch: PluginSwitch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  // BB extras (not shadcn).
  EmptyState,
  Markdown: PluginMarkdown,
  PageBody: PluginPageBody,
  Spinner: PluginSpinner,
} satisfies PluginSdkApp;
