import { mkdir, writeFile } from "node:fs/promises";
import { listPublicApiRoutes } from "../src/public-operations.js";
import { routeCallShape } from "../src/route-calls.js";

const entries = listPublicApiRoutes()
  .map(
    ({ key, route }) =>
      `  ${JSON.stringify(key)}: ${JSON.stringify(routeCallShape(route))},`,
  )
  .sort();
const directory = new URL("../src/generated/", import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(
  new URL("route-index.ts", directory),
  [
    'import type { PublicOperationName } from "../public-operations.js";',
    'import type { RouteCallShape } from "../route-calls.js";',
    "",
    "export const publicRouteIndex = {",
    ...entries,
    "} as const satisfies { readonly [Name in PublicOperationName]: RouteCallShape };",
    "",
  ].join("\n"),
);
