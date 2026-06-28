#!/usr/bin/env node
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

const DEV_BROWSER_PACKAGE = "dev-browser@0.2.8";
const DEFAULT_BROWSER_NAME = "bb-startup-measure";
const DEFAULT_TIMEOUT_SECONDS = 90;
const DEFAULT_SETTLE_MS = 2_000;
const PROFILES = {
  none: null,
  airplane: {
    downloadKibPerSecond: 80,
    latencyMs: 600,
    uploadKibPerSecond: 30,
  },
};
const MIME = {
  ".css": "text/css",
  ".html": "text/html",
  ".ico": "image/x-icon",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};
const PRECOMPRESSED = [
  { encoding: "br", extension: ".br" },
  { encoding: "gzip", extension: ".gz" },
];

function usage() {
  console.error(`Usage:
  node scripts/measure-browser-startup.mjs <url> [--profile none|airplane]
  node scripts/measure-browser-startup.mjs --dist apps/app/dist [--profile none|airplane]

Options:
  --browser-name <name>     dev-browser instance name (default: ${DEFAULT_BROWSER_NAME})
  --settle-ms <ms>          wait after DOMContentLoaded before collecting metrics
  --timeout <seconds>       dev-browser script timeout (default: ${DEFAULT_TIMEOUT_SECONDS})

By default this runs: npx -y ${DEV_BROWSER_PACKAGE} --headless
Set DEV_BROWSER_BIN=dev-browser to use an installed binary instead.`);
}

function takeOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }
  args.splice(index, 2);
  return value;
}

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    usage();
    process.exit(0);
  }

  const browserName =
    takeOption(args, "--browser-name") ?? DEFAULT_BROWSER_NAME;
  const distDir = takeOption(args, "--dist");
  const profileName = takeOption(args, "--profile") ?? "none";
  const settleMs = Number(takeOption(args, "--settle-ms") ?? DEFAULT_SETTLE_MS);
  const timeoutSeconds = Number(
    takeOption(args, "--timeout") ?? DEFAULT_TIMEOUT_SECONDS,
  );

  if (!(profileName in PROFILES)) {
    throw new Error(`Unknown profile "${profileName}"`);
  }
  if (!Number.isFinite(settleMs) || settleMs < 0) {
    throw new Error("--settle-ms must be a non-negative number");
  }
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new Error("--timeout must be a positive number");
  }
  if (distDir !== undefined && args.length > 0) {
    throw new Error("Pass either <url> or --dist, not both");
  }
  if (distDir === undefined && args.length !== 1) {
    throw new Error("Missing URL or --dist");
  }

  return {
    browserName,
    distDir,
    profileName,
    settleMs,
    timeoutSeconds,
    url: args[0],
  };
}

function isWithinRoot(root, filePath) {
  const relativePath = relative(root, filePath);
  return (
    relativePath.length === 0 ||
    (!relativePath.startsWith("..") && !relativePath.startsWith(sep))
  );
}

function acceptsEncoding(acceptEncodingHeader, encoding) {
  if (acceptEncodingHeader === undefined) {
    return false;
  }
  return acceptEncodingHeader.split(",").some((part) => {
    const [rawName, ...rawParams] = part.trim().split(";");
    const name = rawName?.trim().toLowerCase();
    if (name !== encoding && name !== "*") {
      return false;
    }
    const qParam = rawParams
      .map((param) => param.trim().toLowerCase())
      .find((param) => param.startsWith("q="));
    if (qParam === undefined) {
      return true;
    }
    const quality = Number(qParam.slice(2));
    return Number.isNaN(quality) || quality > 0;
  });
}

function findPrecompressedFile(filePath, acceptEncodingHeader) {
  for (const candidate of PRECOMPRESSED) {
    if (!acceptsEncoding(acceptEncodingHeader, candidate.encoding)) {
      continue;
    }
    const encodedFilePath = `${filePath}${candidate.extension}`;
    if (existsSync(encodedFilePath) && statSync(encodedFilePath).isFile()) {
      return {
        encoding: candidate.encoding,
        filePath: encodedFilePath,
      };
    }
  }
  return null;
}

function createStaticDistServer(distDir) {
  const root = resolve(distDir);
  if (!existsSync(resolve(root, "index.html"))) {
    throw new Error(`Missing ${resolve(root, "index.html")}`);
  }

  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (requestUrl.pathname.startsWith("/api/")) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ code: "not_found" }));
      return;
    }

    const urlPath =
      requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
    let filePath = resolve(root, `.${decodeURIComponent(urlPath)}`);
    if (!isWithinRoot(root, filePath) || !existsSync(filePath)) {
      filePath = resolve(root, "index.html");
    }
    if (!statSync(filePath).isFile()) {
      response.writeHead(404);
      response.end();
      return;
    }

    const contentType = MIME[extname(filePath)] ?? "application/octet-stream";
    const cacheControl = urlPath.startsWith("/assets/")
      ? "public, max-age=31536000, immutable"
      : "no-store";
    const precompressed =
      contentType !== "text/html"
        ? findPrecompressedFile(filePath, request.headers["accept-encoding"])
        : null;
    const servedPath = precompressed?.filePath ?? filePath;
    const body = readFileSync(servedPath);
    const headers = {
      "cache-control": cacheControl,
      "content-length": String(body.length),
      "content-type": contentType,
    };
    if (precompressed !== null) {
      headers["content-encoding"] = precompressed.encoding;
      headers.vary = "Accept-Encoding";
    }

    response.writeHead(200, headers);
    response.end(body);
  });

  return new Promise((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("Could not resolve static server address");
      }
      resolvePromise({
        close: () =>
          new Promise((resolveClose, reject) => {
            server.close((error) => {
              if (error) {
                reject(error);
                return;
              }
              resolveClose();
            });
          }),
        url: `http://127.0.0.1:${address.port}/`,
      });
    });
  });
}

function createDevBrowserScript(config) {
  return `
const config = ${JSON.stringify(config)};
const page = await browser.newPage();
const responses = [];

page.on("response", (response) => {
  try {
    const headers = response.headers();
    responses.push({
      contentEncoding: headers["content-encoding"] || null,
      contentLength: headers["content-length"] || null,
      cacheControl: headers["cache-control"] || null,
      resourceType: response.request().resourceType(),
      status: response.status(),
      url: response.url(),
    });
  } catch (_error) {
    // Keep measurement best-effort; resource timing still captures the request.
  }
});

let throttleApplied = false;
if (config.profile !== null) {
  try {
    const client = await page.context().newCDPSession(page);
    await client.send("Network.enable");
    await client.send("Network.setCacheDisabled", { cacheDisabled: true });
    await client.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: config.profile.latencyMs,
      downloadThroughput: config.profile.downloadKibPerSecond * 1024,
      uploadThroughput: config.profile.uploadKibPerSecond * 1024,
    });
    throttleApplied = true;
  } catch (error) {
    console.warn("Could not apply CDP network profile:", String(error));
  }
}

const startedAt = Date.now();
let navigationError = null;
try {
  await page.goto(config.url, {
    waitUntil: "domcontentloaded",
    timeout: config.navigationTimeoutMs,
  });
} catch (error) {
  navigationError = String(error);
}
await page.waitForTimeout(config.settleMs);

const pageMetrics = await page.evaluate(() => {
  const navigation = performance.getEntriesByType("navigation")[0];
  const paints = performance.getEntriesByType("paint").map((entry) => ({
    name: entry.name,
    startTime: entry.startTime,
  }));
  const resources = performance.getEntriesByType("resource").map((entry) => ({
    decodedBodySize: entry.decodedBodySize,
    duration: entry.duration,
    encodedBodySize: entry.encodedBodySize,
    initiatorType: entry.initiatorType,
    name: entry.name,
    startTime: entry.startTime,
    transferSize: entry.transferSize,
  }));
  return {
    bodyText: document.body?.innerText?.slice(0, 240) ?? "",
    navigation: navigation ? {
      decodedBodySize: navigation.decodedBodySize,
      domContentLoadedEventEnd: navigation.domContentLoadedEventEnd,
      duration: navigation.duration,
      encodedBodySize: navigation.encodedBodySize,
      loadEventEnd: navigation.loadEventEnd,
      responseEnd: navigation.responseEnd,
      transferSize: navigation.transferSize,
    } : null,
    paints,
    readyState: document.readyState,
    resources,
    title: document.title,
    url: location.href,
  };
});

const navigation = pageMetrics.navigation;
const resourceTotals = pageMetrics.resources.reduce((total, resource) => ({
  decodedBodySize: total.decodedBodySize + resource.decodedBodySize,
  encodedBodySize: total.encodedBodySize + resource.encodedBodySize,
  transferSize: total.transferSize + resource.transferSize,
}), { decodedBodySize: 0, encodedBodySize: 0, transferSize: 0 });
const totals = {
  decodedBodySize: resourceTotals.decodedBodySize + (navigation?.decodedBodySize ?? 0),
  encodedBodySize: resourceTotals.encodedBodySize + (navigation?.encodedBodySize ?? 0),
  transferSize: resourceTotals.transferSize + (navigation?.transferSize ?? 0),
};
const contentEncodings = responses.reduce((counts, response) => {
  const key = response.contentEncoding ?? "identity";
  counts[key] = (counts[key] ?? 0) + 1;
  return counts;
}, {});
const largestResources = pageMetrics.resources
  .slice()
  .sort((a, b) => b.decodedBodySize - a.decodedBodySize)
  .slice(0, 12);

console.log(JSON.stringify({
  contentEncodings,
  elapsedMs: Date.now() - startedAt,
  largestResources,
  navigation,
  navigationError,
  paints: pageMetrics.paints,
  profileName: config.profileName,
  readyState: pageMetrics.readyState,
  requestCount: responses.length,
  throttleApplied,
  title: pageMetrics.title,
  totals,
  url: pageMetrics.url,
}, null, 2));

await page.close();
`;
}

function runDevBrowser(command, args, input) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolvePromise(code ?? 1);
    });
    child.stdin.end(input);
  });
}

async function main() {
  const options = parseArgs();
  let localServer;
  const url =
    options.distDir === undefined
      ? options.url
      : (localServer = await createStaticDistServer(options.distDir)).url;
  const devBrowserBin = process.env.DEV_BROWSER_BIN;
  const command = devBrowserBin ?? "npx";
  const devBrowserArgs =
    devBrowserBin === undefined ? ["-y", DEV_BROWSER_PACKAGE] : [];
  devBrowserArgs.push(
    "--headless",
    "--browser",
    options.browserName,
    "--timeout",
    String(options.timeoutSeconds),
  );

  try {
    const exitCode = await runDevBrowser(
      command,
      devBrowserArgs,
      createDevBrowserScript({
        navigationTimeoutMs: options.timeoutSeconds * 1000,
        profile: PROFILES[options.profileName],
        profileName: options.profileName,
        settleMs: options.settleMs,
        url,
      }),
    );
    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  } finally {
    if (localServer !== undefined) {
      await localServer.close();
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
