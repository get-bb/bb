import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withTestHarness } from "../helpers/test-app.js";

const bytes = Buffer.from("test-apk-bytes");
const manifest = {
  version: "0.39.0",
  versionCode: 17,
  size: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
};

async function publish(dataDir: string) {
  const directory = join(dataDir, "android-testing");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${manifest.sha256}.apk`), bytes);
  await writeFile(join(directory, "latest.json"), JSON.stringify(manifest));
}

describe("Android testing downloads", () => {
  it("streams cached builds without an experiment and supports conditional requests", async () => {
    await withTestHarness(async ({ app, config }) => {
      await publish(config.dataDir);
      expect(
        await (await app.request("/api/v1/system/android-app")).json(),
      ).toEqual(manifest);
      const download = await app.request("/install/bb-android.apk");
      expect(download.status).toBe(200);
      expect(download.headers.get("content-type")).toBe(
        "application/vnd.android.package-archive",
      );
      expect(download.headers.get("content-disposition")).toBe(
        'attachment; filename="bb-android.apk"',
      );
      expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes);
      const etag = download.headers.get("etag")!;
      expect(
        (
          await app.request("/install/bb-android.apk", {
            headers: { "if-none-match": etag },
          })
        ).status,
      ).toBe(304);
    });
  });

  it("does not offer missing or incomplete builds", async () => {
    await withTestHarness(async ({ app, config }) => {
      expect((await app.request("/install/bb-android.apk")).status).toBe(404);
      await publish(config.dataDir);
      await writeFile(
        join(config.dataDir, "android-testing", `${manifest.sha256}.apk`),
        "truncated",
      );
      expect(
        await (await app.request("/api/v1/system/android-app")).json(),
      ).toBeNull();
      expect((await app.request("/install/bb-android.apk")).status).toBe(404);
    });
  });
});
