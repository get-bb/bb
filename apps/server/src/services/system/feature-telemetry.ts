import {
  publicApiRoutes as routes,
  featureUsedPropertiesSchema,
  type CoreFeature,
  type FeatureUsedProperties,
} from "@bb/server-contract";
import type { Context, Next } from "hono";
import { resolveRequestAppSurface } from "../../request-context.js";
import type { TelemetryService } from "./telemetry.js";

const registry = new Map<string, CoreFeature>();

function register(
  feature: CoreFeature,
  entries: readonly { path: string; method: string }[],
): void {
  for (const entry of entries)
    registry.set(`${entry.method.toUpperCase()} /api/v1${entry.path}`, feature);
}

register("thread", [
  routes.threads.create,
  routes.threads.fork,
  routes.threads.update,
  routes.threads.delete,
  routes.threads.send,
  routes.threads.editMessage,
  routes.threads.retry,
  routes.threads.stop,
  routes.threads.compact,
  routes.threads.clearContext,
  routes.threads.cancelPlan,
  routes.threads.clearGoal,
  routes.threads.open,
  routes.threads.pin,
  routes.threads.unpin,
  routes.threads.archiveAll,
  routes.threads.unarchive,
  routes.threads.resolveInteraction,
  routes.threads.respondToInteraction,
  routes.threads.cancelInteraction,
  routes.threads.createQueuedMessage,
  routes.threads.updateQueuedMessage,
  routes.threads.sendQueuedMessage,
  routes.threads.deleteQueuedMessage,
  routes.threads.reorderQueuedMessage,
  routes.threads.setQueuedMessageGroupBoundary,
  routes.threadSections.create,
  routes.threadSections.update,
  routes.threadSections.delete,
]);
register("project", [
  routes.projects.create,
  routes.projects.update,
  routes.projects.delete,
  routes.projects.createSource,
  routes.projects.updateSource,
  routes.projects.deleteSource,
]);
register("environment", [
  routes.environments.cleanup,
  routes.environments.delete,
  routes.environments.update,
  routes.environments.archiveThreads,
  routes.threads.restoreEnvironment,
]);
register("file", [
  routes.files.write,
  routes.files.mkdir,
  routes.files.move,
  routes.files.remove,
  routes.files.createPreview,
  routes.projects.uploadAttachment,
  routes.projects.copyAttachments,
  routes.projects.updateSkill,
  routes.projects.deleteSkill,
]);
register("git", [routes.environments.actions]);
register("terminal", [
  routes.terminals.create,
  routes.terminals.restart,
  routes.terminals.close,
]);
register("browser", [
  routes.desktopBrowsers.createTab,
  routes.desktopBrowsers.acquireControl,
  routes.desktopBrowsers.closeTab,
  routes.desktopBrowsers.revealTab,
  routes.desktopBrowsers.captureTab,
  routes.desktopBrowsers.importCookies,
]);
register("remote_access", [
  routes.hosts.create,
  routes.hosts.createJoinCode,
  routes.hosts.reconnect,
  routes.hosts.suspend,
  routes.hosts.resume,
  routes.hosts.delete,
  routes.hosts.updatePermissionCeiling,
  routes.server.startMove,
  routes.server.cancelMove,
  routes.server.export,
]);
register("provider", [
  routes.hosts.providerCliInstall,
  routes.system.providerEnabled,
]);
register("voice", [routes.system.voiceTranscription]);
register("settings", [
  routes.system.generalSettings,
  routes.system.keyboardSettings,
  routes.system.appearance,
  routes.system.experiments,
  routes.system.setAiServiceSelection,
  routes.system.installCliSkills,
  routes.system.applyAppUpdate,
  routes.system.setMachineEnvironmentVariable,
  routes.system.deleteMachineEnvironmentVariable,
  routes.system.replaceMachineEnvironment,
  routes.projects.replaceMachineEnvironment,
  routes.projects.setMachineEnvironmentVariable,
  routes.projects.deleteMachineEnvironmentVariable,
]);

export function captureFeatureUsed(
  telemetry: TelemetryService,
  properties: FeatureUsedProperties,
): void {
  try {
    const result = featureUsedPropertiesSchema.safeParse(properties);
    if (result.success)
      telemetry.capture({ name: "feature_used", properties: result.data });
  } catch {}
}

export function coreFeatureTelemetry(getTelemetry: () => TelemetryService) {
  return async (context: Context, next: Next): Promise<void> => {
    await next();
    if (context.res.status < 200 || context.res.status >= 300) return;
    const feature = registry.get(
      `${context.req.method} ${context.req.routePath}`,
    );
    if (feature === undefined) return;
    captureFeatureUsed(getTelemetry(), {
      feature,
      feature_scope: "core",
      interaction: "invoked",
      trigger:
        resolveRequestAppSurface(context) === "api" ? "unknown" : "person",
    });
  };
}
