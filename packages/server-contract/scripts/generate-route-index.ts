import { mkdir, writeFile } from "node:fs/promises";
import { listPublicApiRoutes } from "../src/public-operations.js";
import { encodeRouteCall, routeCallShape } from "../src/route-calls.js";

const areas = new Map<string, string[]>();
for (const { key, route } of listPublicApiRoutes()) {
  const dot = key.indexOf(".");
  const area = key.slice(0, dot);
  const entries = areas.get(area) ?? [];
  entries.push(
    `    ${JSON.stringify(key.slice(dot + 1))}: ${JSON.stringify(encodeRouteCall(routeCallShape(route)))},`,
  );
  areas.set(area, entries);
}
const lines = [...areas.keys()].sort().flatMap((area) => [
  `  ${JSON.stringify(area)}: {`,
  ...(areas.get(area) ?? []).sort(),
  "  },",
]);
const directory = new URL("../src/generated/", import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(
  new URL("route-index.ts", directory),
  [
    'import type { PublicOperationName } from "../public-operations.js";',
    'import type { RouteIndex } from "../route-calls.js";',
    "",
    "export const publicRouteIndex = {",
    ...lines,
    "} as const satisfies RouteIndex<PublicOperationName>;",
    "",
  ].join("\n"),
);
