import { useEffect, useState } from "react";
import type { PluginBrowserActionProps } from "@get-bb/plugin-sdk/app";
import type { IconName } from "@bb/shared-ui/icon";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import {
  getAnnotationToolbarController,
  subscribeAnnotationToolbarRegistry,
  type AnnotationToolbarMode,
} from "./annotation-toolbar-bridge";

interface ToolbarActionButton {
  icon: IconName;
  ariaLabel: string;
  label: string;
}

const TOOLBAR_BUTTON_CLASS = cn(
  COARSE_POINTER_HEADER_ICON_BUTTON_CLASS,
  "flex shrink-0 items-center justify-center transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
);

type BrowserAnnotationToolbarAction = "annotate" | "grab" | "screenshot";

function BrowserAnnotationToolbarAction(
  props: PluginBrowserActionProps & { action: BrowserAnnotationToolbarAction },
) {
  const [controller, setController] = useState(() =>
    getAnnotationToolbarController(props.tabId),
  );
  const [interaction, setInteraction] = useState(() => {
    const state = getAnnotationToolbarController(
      props.tabId,
    )?.getInteractionState();
    return (
      state ?? {
        pickerMode: null as AnnotationToolbarMode | null,
        reviewOpen: false,
        editorOpen: false,
        browserControlAvailable: false,
      }
    );
  });

  useEffect(() => {
    const refresh = () => {
      const current = getAnnotationToolbarController(props.tabId);
      setController(current);
      if (current !== null) {
        setInteraction(current.getInteractionState());
      }
    };
    refresh();
    return subscribeAnnotationToolbarRegistry(refresh);
  }, [props.tabId]);

  useEffect(() => {
    if (controller === null) return;
    const unsubscribe = controller.subscribe(() => {
      setInteraction(controller.getInteractionState());
    });
    setInteraction(controller.getInteractionState());
    return unsubscribe;
  }, [controller]);

  const browserControlAvailable = interaction.browserControlAvailable;
  const canCapture = browserControlAvailable;
  const controllerMounted = controller !== null;
  const pickerMode: AnnotationToolbarMode | null = interaction.pickerMode;
  const hasActiveOverlay =
    interaction.editorOpen || interaction.reviewOpen || pickerMode !== null;

  const startPicker = (mode: AnnotationToolbarMode) => {
    if (!browserControlAvailable || !controllerMounted) return;
    if (pickerMode === mode) {
      controller?.cancelPicker();
      return;
    }
    if (
      pickerMode !== null ||
      interaction.editorOpen ||
      interaction.reviewOpen
    ) {
      return;
    }
    controller?.startPicker(mode);
  };
  const startScreenshotEditor = () => {
    if (!canCapture || hasActiveOverlay || !controllerMounted) return;
    controller?.startScreenshotEditor();
  };

  const annotateButton: ToolbarActionButton = {
    icon: pickerMode === "annotate" ? "X" : "MessageSquarePlus",
    ariaLabel:
      pickerMode === "annotate"
        ? "Cancel element annotation"
        : "Select and annotate page element",
    label:
      pickerMode === "annotate"
        ? "Cancel element annotation"
        : "Select and annotate page element",
  };
  const grabButton: ToolbarActionButton = {
    icon: pickerMode === "grab" ? "X" : "Eye",
    ariaLabel:
      pickerMode === "grab" ? "Cancel element selection" : "Grab page element",
    label:
      pickerMode === "grab" ? "Cancel element selection" : "Grab page element",
  };
  const screenshotButton: ToolbarActionButton = {
    icon: "EditFile",
    ariaLabel: "Annotate screenshot",
    label: "Annotate screenshot",
  };

  const unavailableTitle = browserControlAvailable
    ? undefined
    : "Requires a newer BB desktop app";

  const pickerAction: AnnotationToolbarMode =
    props.action === "grab" ? "grab" : "annotate";
  const button =
    props.action === "screenshot"
      ? screenshotButton
      : props.action === "grab"
        ? grabButton
        : annotateButton;
  const disabled =
    props.action === "screenshot"
      ? !canCapture || hasActiveOverlay || !controllerMounted
      : props.action === "grab"
        ? pickerMode === "annotate" ||
          !controllerMounted ||
          (!browserControlAvailable && pickerMode !== "grab")
        : pickerMode === "grab" ||
          !controllerMounted ||
          (!browserControlAvailable && pickerMode !== "annotate");
  const onClick =
    props.action === "screenshot"
      ? startScreenshotEditor
      : () => startPicker(pickerAction);
  return (
    <ToolbarButton
      button={button}
      disabled={disabled}
      onClick={onClick}
      title={unavailableTitle}
    />
  );
}

export function BrowserAnnotationScreenshotAction(
  props: PluginBrowserActionProps,
) {
  return <BrowserAnnotationToolbarAction {...props} action="screenshot" />;
}

export function BrowserAnnotationGrabAction(props: PluginBrowserActionProps) {
  return <BrowserAnnotationToolbarAction {...props} action="grab" />;
}

export function BrowserAnnotationAnnotateAction(
  props: PluginBrowserActionProps,
) {
  return <BrowserAnnotationToolbarAction {...props} action="annotate" />;
}

export function BrowserAnnotationToolbar(props: PluginBrowserActionProps) {
  return (
    <div
      role="group"
      aria-label="Page annotations"
      className="flex shrink-0 items-center"
    >
      <BrowserAnnotationScreenshotAction {...props} />
      <BrowserAnnotationGrabAction {...props} />
      <BrowserAnnotationAnnotateAction {...props} />
    </div>
  );
}

function ToolbarButton({
  button,
  disabled,
  onClick,
  title,
}: {
  button: ToolbarActionButton;
  disabled: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-label={button.ariaLabel}
      disabled={disabled}
      title={title ?? button.label}
      onClick={onClick}
      className={cn(TOOLBAR_BUTTON_CLASS)}
    >
      <Icon name={button.icon} aria-hidden className="size-4" />
    </button>
  );
}
