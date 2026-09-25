import { useCallback, useEffect } from "react";
import {
  TouchSensor,
  type DragEndEvent,
  type DragStartEvent,
  type SensorProps,
  type TouchSensorOptions,
} from "@dnd-kit/core";
import {
  useReorderDnd,
  type UseReorderDndArgs,
  type UseReorderDndResult,
} from "../ui/useReorderDnd.js";

function setSidebarDraggingCursor(active: boolean): void {
  if (active) {
    document.body.dataset.sidebarDragging = "true";
    return;
  }
  delete document.body.dataset.sidebarDragging;
}

type UseSidebarReorderDndArgs = Omit<UseReorderDndArgs, "touchSensor">;

const TOUCH_DRAG_DISTANCE_PX = 12;
const TOUCH_HOLD_TOLERANCE_PX = 6;

export class SidebarTouchSensor {
  static activators = TouchSensor.activators;

  autoScrollEnabled = true;
  private readonly props: SensorProps<TouchSensorOptions>;
  private readonly document: Document;
  private readonly activator: HTMLElement | null;
  private readonly armedChip: HTMLElement | null;
  private readonly initialCoordinates: { x: number; y: number };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private armed = false;
  private dragging = false;

  constructor(props: SensorProps<TouchSensorOptions>) {
    this.props = props;
    const event = props.event;
    if (!(event instanceof TouchEvent) || event.touches.length !== 1) {
      throw new Error("SidebarTouchSensor requires a single touch");
    }
    const touch = event.touches[0];
    this.initialCoordinates = { x: touch.clientX, y: touch.clientY };
    this.document = event.target instanceof Node ? event.target.ownerDocument ?? document : document;
    this.activator = props.activeNode.activatorNode.current ?? props.activeNode.node.current;
    this.armedChip = this.activator?.querySelector("[data-sidebar-touch-armed-chip]") ?? null;
    this.document.addEventListener("touchmove", this.handleMove, { passive: false });
    this.document.addEventListener("touchend", this.handleEnd);
    this.document.addEventListener("touchcancel", this.handleCancel);
    this.document.addEventListener("keydown", this.handleKeyDown);
    this.document.addEventListener("visibilitychange", this.handleCancel);
    this.document.defaultView?.addEventListener("blur", this.handleCancel);
    this.document.defaultView?.addEventListener("resize", this.handleCancel);
    const constraint = props.options.activationConstraint;
    const delay = constraint && "delay" in constraint ? constraint.delay : 500;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.armed = true;
      this.activator?.setAttribute("data-sidebar-touch-armed", "true");
      if (this.armedChip) {
        const rect = this.armedChip.getBoundingClientRect();
        this.armedChip.style.transform = `translate(${this.initialCoordinates.x - rect.left - rect.width / 2}px, ${this.initialCoordinates.y - rect.top - rect.height / 2}px)`;
      }
    }, delay);
  }

  private readonly handleMove = (event: TouchEvent): void => {
    const touch = event.touches[0];
    if (!touch || event.touches.length !== 1) {
      this.handleCancel();
      return;
    }
    const coordinates = { x: touch.clientX, y: touch.clientY };
    const distance = Math.hypot(
      coordinates.x - this.initialCoordinates.x,
      coordinates.y - this.initialCoordinates.y,
    );
    if (!this.armed && !this.dragging) {
      if (distance > TOUCH_HOLD_TOLERANCE_PX) this.handleCancel();
      return;
    }
    if (!this.dragging) {
      if (distance <= TOUCH_DRAG_DISTANCE_PX) return;
      this.dragging = true;
      this.activator?.removeAttribute("data-sidebar-touch-armed");
      this.props.onStart(this.initialCoordinates);
    }
    if (event.cancelable) event.preventDefault();
    this.props.onMove(coordinates);
  };

  private readonly handleEnd = (): void => {
    this.detach();
    if (!this.dragging) this.props.onAbort(this.props.active);
    this.props.onEnd();
  };

  private readonly handleCancel = (): void => {
    this.detach();
    if (!this.dragging) this.props.onAbort(this.props.active);
    this.props.onCancel();
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.code === "Escape") this.handleCancel();
  };

  private detach(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.activator?.removeAttribute("data-sidebar-touch-armed");
    this.armedChip?.style.removeProperty("transform");
    this.document.removeEventListener("touchmove", this.handleMove);
    this.document.removeEventListener("touchend", this.handleEnd);
    this.document.removeEventListener("touchcancel", this.handleCancel);
    this.document.removeEventListener("keydown", this.handleKeyDown);
    this.document.removeEventListener("visibilitychange", this.handleCancel);
    this.document.defaultView?.removeEventListener("blur", this.handleCancel);
    this.document.defaultView?.removeEventListener("resize", this.handleCancel);
  }

  static setup(): () => void {
    if (typeof window === "undefined") {
      return () => {};
    }
    const noop = () => {};
    window.addEventListener("touchmove", noop, {
      capture: false,
      passive: false,
    });
    return () => {
      window.removeEventListener("touchmove", noop);
    };
  }
}

export function useSidebarReorderDnd({
  onDragEnd,
  onDragStart,
  onDragMove,
  onDragOver,
  onDragCancel,
  collisionDetection,
  axis,
  measuring,
}: UseSidebarReorderDndArgs): UseReorderDndResult {
  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      setSidebarDraggingCursor(true);
      onDragStart?.(event);
    },
    [onDragStart],
  );
  const handleDragCancel = useCallback(() => {
    setSidebarDraggingCursor(false);
    onDragCancel?.();
  }, [onDragCancel]);
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setSidebarDraggingCursor(false);
      onDragEnd(event);
    },
    [onDragEnd],
  );

  useEffect(() => {
    return () => {
      setSidebarDraggingCursor(false);
    };
  }, []);

  return useReorderDnd({
    onDragEnd: handleDragEnd,
    onDragStart: handleDragStart,
    onDragMove,
    onDragOver,
    onDragCancel: handleDragCancel,
    collisionDetection,
    touchSensor: SidebarTouchSensor,
    axis,
    measuring,
  });
}
