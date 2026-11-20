import { describe, expect, it } from "vitest";
import {
  LIST_PAGE_DEFAULT_LIMIT,
  LIST_PAGE_MAX_LIMIT,
} from "@bb/server-contract";
import type { AppDeps } from "../../src/types.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const ROWS = LIST_PAGE_DEFAULT_LIMIT + 1;

interface ListRouteCase {
  name: string;
  seed: (deps: AppDeps) => string;
}

const LIST_ROUTES: readonly ListRouteCase[] = [
  {
    name: "/api/v1/threads",
    seed: (deps) => {
      const { host } = seedHostSession(deps, { id: "host-thread-pages" });
      const { project } = seedProjectWithSource(deps, { hostId: host.id });
      for (let index = 0; index < ROWS; index += 1) {
        seedThread(deps, { projectId: project.id });
      }
      return `/api/v1/threads?projectId=${project.id}`;
    },
  },
  {
    name: "/api/v1/environments",
    seed: (deps) => {
      const { host } = seedHostSession(deps, { id: "host-list-pages" });
      const { project } = seedProjectWithSource(deps, { hostId: host.id });
      for (let index = 0; index < ROWS; index += 1) {
        seedEnvironment(deps, {
          hostId: host.id,
          projectId: project.id,
          path: `/tmp/list-pages-${index}`,
        });
      }
      return `/api/v1/environments?projectId=${project.id}`;
    },
  },
];

describe.each(LIST_ROUTES)("GET $name pages", ({ seed }) => {
  it("returns the default page without a limit, up to the maximum with one, and rejects more", async () => {
    await withTestHarness(async (harness) => {
      const path = seed(harness.deps);

      const defaultPage = await harness.app.request(path);
      expect(defaultPage.status).toBe(200);
      const defaultRows = (await readJson(defaultPage)) as Array<{
        id: string;
      }>;
      expect(defaultRows).toHaveLength(LIST_PAGE_DEFAULT_LIMIT);

      const rest = (await readJson(
        await harness.app.request(`${path}&offset=${LIST_PAGE_DEFAULT_LIMIT}`),
      )) as Array<{ id: string }>;
      expect(new Set([...defaultRows, ...rest].map((row) => row.id)).size).toBe(
        ROWS,
      );

      const maxPage = (await readJson(
        await harness.app.request(`${path}&limit=${LIST_PAGE_MAX_LIMIT}`),
      )) as Array<{ id: string }>;
      expect(maxPage).toHaveLength(ROWS);

      const overMax = await harness.app.request(
        `${path}&limit=${LIST_PAGE_MAX_LIMIT + 1}`,
      );
      expect(overMax.status).toBe(400);
      await expect(readJson(overMax)).resolves.toMatchObject({
        code: "invalid_request",
        message: `limit cannot exceed ${LIST_PAGE_MAX_LIMIT}; page with offset`,
      });
    });
  });
});
