import { vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";

export const LOCAL_FILE_TEST_HOST_ID = "host-local-files";

export function createMarkdownLocalFileHostTestWrapper(
  exists: (path: string) => boolean,
) {
  const pathsExist = vi
    .spyOn(sdk.hosts, "pathsExist")
    .mockImplementation(async ({ paths }) => ({
      existence: Object.fromEntries(paths.map((path) => [path, exists(path)])),
    }));
  const { wrapper } = createQueryClientTestHarness();
  return { pathsExist, wrapper };
}
