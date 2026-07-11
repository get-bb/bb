import type { AppDeps } from "./types.js";

export type LifecycleCoordinationDeps = Pick<
  AppDeps,
  | "config"
  | "db"
  | "hub"
  | "lifecycleDedupers"
  | "logger"
  | "machineAuth"
  | "skillTreeRegistry"
  | "telemetry"
>;

export type InteractiveLifecycleCoordinationDeps = LifecycleCoordinationDeps &
  Pick<AppDeps, "pendingInteractions">;
