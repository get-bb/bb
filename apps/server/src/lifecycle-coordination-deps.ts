import type { AppDeps } from "./types.js";

export type LifecycleCoordinationDeps = Pick<
  AppDeps,
  | "config"
  | "db"
  | "hub"
  | "lifecycleDedupers"
  | "logger"
  | "machineAuth"
  | "telemetry"
>;

export type InteractiveLifecycleCoordinationDeps = LifecycleCoordinationDeps &
  Pick<AppDeps, "pendingInteractions">;
