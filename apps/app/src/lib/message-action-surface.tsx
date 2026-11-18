import { createContext, useContext, useMemo } from "react";
import type { ExperimentalMessageActionSurface } from "@get-bb/plugin-sdk";
import {
  usePluginSlotKind,
  type PluginMessageActionSlot,
} from "./plugin-slots";

const MessageActionSurfaceContext =
  createContext<ExperimentalMessageActionSurface>("thread-view");

export const MessageActionSurfaceProvider =
  MessageActionSurfaceContext.Provider;

export function useSurfaceMessageActionSlots(): readonly PluginMessageActionSlot[] {
  const surface = useContext(MessageActionSurfaceContext);
  const slots = usePluginSlotKind("messageActions");
  return useMemo(
    () =>
      slots.every((slot) => slot.experimental_surfaces.includes(surface))
        ? slots
        : slots.filter((slot) => slot.experimental_surfaces.includes(surface)),
    [slots, surface],
  );
}
