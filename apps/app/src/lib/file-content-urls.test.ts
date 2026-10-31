import { expect, it } from "vitest";
import { buildHostFileContentUrl } from "./file-content-urls";

it.each([
  ["/Users/me/a b.png", "/api/v1/hosts/host_1/files/Users/me/a%20b.png"],
  ["C:\\Users\\me\\a.png", "/api/v1/hosts/host_1/files/C%3A/Users/me/a.png"],
  [
    "\\\\server\\share\\dir\\a b.png",
    "/api/v1/hosts/host_1/files/%5C%5Cserver/share/dir/a%20b.png",
  ],
  [
    "//server/share/dir/a.png",
    "/api/v1/hosts/host_1/files/%5C%5Cserver/share/dir/a.png",
  ],
])("keeps the root of %s in the host file URL", (path, url) => {
  expect(buildHostFileContentUrl("host_1", path)).toBe(url);
});
