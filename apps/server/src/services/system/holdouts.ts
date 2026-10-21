import { randomInt } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  appSettingsValues,
  getAppSettings,
  holdoutAssignments,
  threads,
  type DbConnection,
} from "@bb/db";
import {
  holdoutRegistry,
  holdoutRegistrySchema,
  type HoldoutArm,
  type HoldoutDefinition,
  type HoldoutForce,
} from "@bb/domain";
import type { ServerLogger } from "../../types.js";
import type { TelemetryService } from "./telemetry.js";

function drawArm(definition: HoldoutDefinition): HoldoutArm {
  let draw = randomInt(
    definition.weights.reduce((sum, weight) => sum + weight, 0),
  );
  for (const [index, arm] of definition.arms.entries()) {
    const weight = definition.weights[index]!;
    if (draw < weight) return arm;
    draw -= weight;
  }
  throw new Error("Holdout weights did not cover the draw");
}

export function createHoldoutService(args: {
  db: DbConnection;
  appVersion: string;
  pendingMove: boolean;
  force: HoldoutForce | null;
  logger: ServerLogger;
  registry?: HoldoutDefinition[];
}) {
  const registry = holdoutRegistrySchema.parse(
    args.registry ?? holdoutRegistry,
  );
  const { db, force } = args;
  const excluded = new Set<string>();
  let available = !args.pendingMove;
  const exclusionKey = (key: string) => `holdout_qa_excluded:${key}`;
  try {
    if (available) {
      db.transaction(() => {
        if (force !== null) {
          db.insert(appSettingsValues)
            .values({
              key: exclusionKey(force.key),
              value: "true",
              updatedAt: Date.now(),
            })
            .onConflictDoNothing()
            .run();
        }
        for (const definition of registry) {
          if (
            db
              .select({ key: appSettingsValues.key })
              .from(appSettingsValues)
              .where(eq(appSettingsValues.key, exclusionKey(definition.key)))
              .get()
          )
            excluded.add(definition.key);
        }
        const isNew =
          getAppSettings(db).onboardingCompletedAt === null &&
          db.select({ id: threads.id }).from(threads).limit(1).get() ===
            undefined;
        if (!isNew) return;
        for (const definition of registry) {
          if (definition.status !== "enrolling" || excluded.has(definition.key))
            continue;
          if (
            db
              .select({ key: holdoutAssignments.key })
              .from(holdoutAssignments)
              .where(eq(holdoutAssignments.key, definition.key))
              .get()
          )
            continue;
          db.insert(holdoutAssignments)
            .values({
              key: definition.key,
              arm: drawArm(definition),
              assignedAt: Date.now(),
              appVersion: args.appVersion,
              exposedAt: null,
            })
            .onConflictDoNothing()
            .run();
        }
      });
    }
  } catch (error) {
    available = false;
    args.logger.warn({ err: error }, "Holdout enrollment unavailable");
  }
  function assignment(key: string) {
    if (!available || excluded.has(key)) return undefined;
    return db
      .select()
      .from(holdoutAssignments)
      .where(eq(holdoutAssignments.key, key))
      .get();
  }
  function arm(key: string): HoldoutArm | null {
    const definition = registry.find((entry) => entry.key === key);
    if (definition === undefined) return null;
    if (definition.status === "ended")
      return definition.winner ?? definition.arms[0];
    if (force?.key === key) return force.arm;
    try {
      const stored = assignment(key)?.arm;
      return stored !== undefined && definition.arms.includes(stored)
        ? stored
        : definition.arms[0];
    } catch {
      return definition.arms[0];
    }
  }
  function list() {
    if (!available || registry.length === 0) return [];
    return db
      .select()
      .from(holdoutAssignments)
      .where(
        inArray(
          holdoutAssignments.key,
          registry.map((entry) => entry.key),
        ),
      )
      .all()
      .flatMap((row) => {
        const definition = registry.find((entry) => entry.key === row.key);
        if (
          definition === undefined ||
          !definition.arms.includes(row.arm) ||
          excluded.has(row.key)
        )
          return [];
        return [
          {
            key: definition.key,
            variant: row.arm,
            assignedAt: row.assignedAt,
            exposedAt: row.exposedAt,
            appVersion: row.appVersion,
            status: definition.status,
          },
        ];
      });
  }
  function properties(): Record<string, HoldoutArm> {
    try {
      return Object.fromEntries(
        list()
          .filter((row) => row.status !== "ended")
          .map((row) => [`$feature/${row.key}`, row.variant]),
      );
    } catch {
      return {};
    }
  }
  function expose(key: string, telemetry: TelemetryService): boolean {
    const definition = registry.find((entry) => entry.key === key);
    if (
      !available ||
      excluded.has(key) ||
      definition === undefined ||
      definition.status === "ended"
    )
      return false;
    try {
      const row = db
        .update(holdoutAssignments)
        .set({ exposedAt: Date.now() })
        .where(
          and(
            eq(holdoutAssignments.key, key),
            isNull(holdoutAssignments.exposedAt),
          ),
        )
        .returning()
        .get();
      if (row === undefined || !definition.arms.includes(row.arm)) return false;
      telemetry.capture({
        name: "experiment_exposed",
        properties: { experiment_id: key, variant: row.arm },
      });
      return true;
    } catch (error) {
      args.logger.warn({ err: error }, "Holdout exposure unavailable");
      return false;
    }
  }
  return { arm, list, properties, expose };
}
export type HoldoutService = ReturnType<typeof createHoldoutService>;
