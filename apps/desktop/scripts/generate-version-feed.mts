import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import {
  bbDesktopVersionFeedSchema,
  type BbDesktopVersionFeed,
} from "@bb/desktop-contract";

const packageRoot = process.cwd();
const packageJsonPath = resolve(packageRoot, "package.json");
const latestMacPath = resolve(packageRoot, "release", "latest-mac.yml");
const desktopVersionFeedPath = resolve(
  packageRoot,
  "release",
  "desktop-version.json",
);

const packageJsonSchema = z.object({
  version: z.string().min(1),
});

const latestMacFileSchema = z.object({
  url: z.string().min(1),
  sha512: z.string().min(1),
  size: z.number().int().nonnegative(),
});

const latestMacSchema = z.object({
  version: z.string().min(1),
  files: z.array(latestMacFileSchema).min(1),
  path: z.string().min(1),
  sha512: z.string().min(1),
  releaseDate: z.iso.datetime(),
});

function parseJson(text: string): unknown {
  return JSON.parse(text);
}

const packageJson = packageJsonSchema.parse(
  parseJson(await readFile(packageJsonPath, "utf8")),
);
const latestMac = latestMacSchema.parse(
  parseYaml(await readFile(latestMacPath, "utf8")),
);

if (latestMac.version !== packageJson.version) {
  throw new Error(
    `latest-mac.yml version ${latestMac.version} did not match apps/desktop/package.json version ${packageJson.version}`,
  );
}

const desktopVersionFeed: BbDesktopVersionFeed = {
  channel: "latest",
  files: latestMac.files,
  minimumSystemVersion: null,
  path: latestMac.path,
  platform: "macos",
  releaseDate: latestMac.releaseDate,
  releaseName: `bb desktop ${packageJson.version}`,
  releaseNotes: null,
  schemaVersion: 1,
  sha512: latestMac.sha512,
  stagingPercentage: null,
  version: packageJson.version,
};

const validatedFeed = bbDesktopVersionFeedSchema.parse(desktopVersionFeed);
await writeFile(
  desktopVersionFeedPath,
  `${JSON.stringify(validatedFeed, null, 2)}\n`,
  "utf8",
);

process.stdout.write(`Wrote ${desktopVersionFeedPath}\n`);
