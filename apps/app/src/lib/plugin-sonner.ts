import * as sonner from "sonner";
import { createPluginToast } from "@/lib/notifications/plugin-toast";

export * from "sonner";
export const toast = createPluginToast(sonner.toast);
