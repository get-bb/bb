import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const [apk, dataDir] = process.argv.slice(2);
if (!apk || !dataDir || process.argv.length !== 4) {
  throw new Error(
    "Usage: node scripts/publish-android-apk.mjs <apk> <server-data-dir>",
  );
}
const sdk =
  process.env.ANDROID_HOME ??
  process.env.ANDROID_SDK_ROOT ??
  join(homedir(), "Library", "Android", "sdk");
const buildTools = join(sdk, "build-tools");
const versions = (await readdir(buildTools)).sort((a, b) =>
  b.localeCompare(a, undefined, { numeric: true }),
);
if (!versions[0]) throw new Error("Install Android SDK build-tools first.");
const badging = execFileSync(
  join(buildTools, versions[0], "aapt"),
  ["dump", "badging", resolve(apk)],
  { encoding: "utf8" },
);
const packageLine =
  badging.split("\n").find((line) => line.startsWith("package: ")) ?? "";
const packageName = packageLine.match(/name='([^']+)'/)?.[1];
const version = packageLine.match(/versionName='([^']+)'/)?.[1];
const versionCode = Number(packageLine.match(/versionCode='(\d+)'/)?.[1]);
if (
  packageName !== "app.getbb.mobile" ||
  !version ||
  !Number.isSafeInteger(versionCode) ||
  versionCode <= 0
) {
  throw new Error(
    "Expected a bb mobile APK with a valid version name and code.",
  );
}
execFileSync(
  join(buildTools, versions[0], "apksigner"),
  ["verify", resolve(apk)],
  { stdio: "pipe" },
);
const directory = join(resolve(dataDir), "android-testing");
await mkdir(directory, { recursive: true });
const staging = join(directory, `${randomUUID()}.tmp`);
try {
  await copyFile(resolve(apk), staging);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(staging)) hash.update(chunk);
  const sha256 = hash.digest("hex");
  const { size } = await stat(staging);
  await rename(staging, join(directory, `${sha256}.apk`));
  await writeFile(
    staging,
    JSON.stringify({ version, versionCode, size, sha256 }) + "\n",
  );
  await rename(staging, join(directory, "latest.json"));
  console.log(`Published Android ${version} (build ${versionCode}), ${sha256}`);
} finally {
  await rm(staging, { force: true });
}
