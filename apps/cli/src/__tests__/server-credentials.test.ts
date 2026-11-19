import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  forgetServerCredential,
  readServerCredential,
  saveServerCredential,
} from "../server-credentials.js";

const directories: string[] = [];

afterEach(async () => {
  while (directories.length > 0) {
    await rm(directories.pop()!, { recursive: true, force: true });
  }
});

async function credentialsPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "bb-cli-credentials-"));
  directories.push(directory);
  return join(directory, "server-credentials.json");
}

describe("server credentials", () => {
  it("hands a token only to the exact origin it was signed in at", async () => {
    const path = await credentialsPath();
    saveServerCredential(
      "https://box.tail1234.ts.net/some/path",
      { token: "bbs_secret", credentialId: "acc_1", label: "bb CLI" },
      path,
    );

    expect(
      readServerCredential("https://box.tail1234.ts.net/api/v1/threads", path),
    ).toMatchObject({ token: "bbs_secret" });
    for (const other of [
      "http://box.tail1234.ts.net/api/v1/threads",
      "https://box.tail1234.ts.net:8443/api/v1/threads",
      "http://100.64.0.5:38886/api/v1/threads",
    ]) {
      expect(readServerCredential(other, path)).toBeNull();
    }
    expect((await stat(path)).mode & 0o777).toBe(0o600);

    expect(forgetServerCredential("https://box.tail1234.ts.net", path)).toBe(
      true,
    );
    expect(
      readServerCredential("https://box.tail1234.ts.net", path),
    ).toBeNull();
  });
});
