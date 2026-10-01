import { PROVIDERS } from "../src/fixtures/providers.js";
import { pluginPackageJsonSchema } from "@bb/domain";
import {
  pluginListResponseSchema,
  type InstalledPlugin,
} from "@bb/server-contract";
import { z } from "zod";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const destination = new URL("../dist/", import.meta.url);
await rm(destination, { recursive: true, force: true });
await cp(new URL("../../app/dist/", import.meta.url), destination, {
  recursive: true,
  filter: (source) => !source.endsWith(".gz") && !source.endsWith(".br"),
});

const providerAssets = new URL("demo-providers/", destination);
await mkdir(providerAssets, { recursive: true });
for (const provider of PROVIDERS) {
  await cp(
    new URL(
      `../../../plugins/provider-${provider.id}/icons/${provider.id}.svg`,
      import.meta.url,
    ),
    new URL(`${provider.id}.svg`, providerAssets),
  );
}

const plugins: InstalledPlugin[] = [];
const artifactMetaSchema = z.object({
  sdkMajor: z.number().int(),
  sdkVersion: z.string(),
});
for (const id of ["navigation", "thread-list"]) {
  const source = new URL(
    `../../../plugins/${id}/.bundled-runtime/`,
    import.meta.url,
  );
  const pkg = pluginPackageJsonSchema.parse(
    JSON.parse(await readFile(new URL("package.json", source), "utf8")),
  );
  const meta = artifactMetaSchema.parse(
    JSON.parse(await readFile(new URL("dist/app.meta.json", source), "utf8")),
  );
  const assetDir = new URL(`demo-plugins/${id}/`, destination);
  await mkdir(assetDir, { recursive: true });
  const js = await readFile(new URL("dist/app.js", source));
  const css = await readFile(new URL("dist/app.css", source));
  const hash = createHash("sha256")
    .update(js)
    .update(css)
    .update(meta.sdkVersion)
    .digest("hex")
    .slice(0, 16);
  await writeFile(new URL("app.js", assetDir), js);
  await writeFile(new URL("app.css", assetDir), css);
  plugins.push({
    id,
    source: `builtin:${id}`,
    rootDir: `/demo/plugins/${id}`,
    version: pkg.version,
    provenance: "builtin",
    isOrphanedBuiltin: false,
    publisherLabel: "BB Official",
    sourceDisplay: "Built-in demo frontend",
    updateState: {},
    enabled: true,
    description: pkg.bb.description,
    name: pkg.bb.name,
    screenshots: [],
    collections: [],
    icon: pkg.bb.branding.icon ?? null,
    iconUrl: null,
    status: "running",
    statusDetail: null,
    handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
    services: [],
    schedules: [],
    cliCommand: null,
    capabilities: [],
    hasSettings: false,
    app: {
      hasApp: true,
      bundle: {
        jsUrl: `/demo-plugins/${id}/app.js?h=${hash}`,
        cssUrl: `/demo-plugins/${id}/app.css?h=${hash}`,
        jsBytes: js.byteLength,
        hash,
        sdkMajor: meta.sdkMajor,
        sdkVersion: meta.sdkVersion,
        compatible: true,
      },
    },
    logoUrl: null,
    logoDarkUrl: null,
    providerIds: [],
    icons: {},
  });
}
await writeFile(
  new URL("demo-plugins/list.json", destination),
  JSON.stringify(pluginListResponseSchema.parse({ plugins })),
);
