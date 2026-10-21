import type { QueryClient, QueryFunctionContext } from "@tanstack/react-query";
import type {
  ReadDependency,
  ReadChange,
  ReadChangeReaction,
  ChangedMessage,
} from "@bb/domain";
import { CORE_CHANGE_SCOPE, liveQueryMeta } from "@bb/query-changes";

export function coreRead<Data>(
  dependencies:
    | ReadDependency
    | readonly ReadDependency[]
    | ((client: QueryClient) => readonly ReadDependency[]),
  read: (context: QueryFunctionContext) => Promise<Data>,
  reactToChange?: (
    data: Data | undefined,
    change: ReadChange,
  ) => ReadChangeReaction<Data>,
) {
  return liveQueryMeta<Data>({
    read,
    scope: CORE_CHANGE_SCOPE,
    dependenciesOf: (_data, client) =>
      typeof dependencies === "function"
        ? dependencies(client)
        : "entity" in dependencies
          ? [dependencies]
          : dependencies,
    reactToChange,
  });
}

export function dependency<
  Entity extends Exclude<ChangedMessage["entity"], "read" | "plugin">,
>(
  entity: Entity,
  changes: Extract<ChangedMessage, { entity: Entity }>["changes"],
  id?: string,
): ReadDependency {
  return { entity, id, changes };
}

export const PLUGIN_DEPENDENCY = dependency("system", ["plugins-changed"]);
export const SYSTEM_CONFIG_DEPENDENCY = dependency("system", [
  "config-changed",
  "plugins-changed",
]);
