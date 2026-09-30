import semver from "semver";
import { z } from "zod";
import { isNightlyAppVersion } from "@bb/config/app-update";
import type { SystemVersionResponse } from "@bb/server-contract";
import type { ServerLogger, ServerRuntimeConfig } from "../../types.js";

const NPM_REGISTRY_PACKAGE_URL = "https://registry.npmjs.org/bb-app";
const NPM_LATEST_TIMEOUT_MS = 5_000;
const NPM_LATEST_CACHE_TTL_MS = 60 * 60 * 1000;

function resolveDistTag(appVersion: string): "latest" | "nightly" {
  return isNightlyAppVersion(appVersion) ? "nightly" : "latest";
}

const npmLatestResponseSchema = z
  .object({
    version: z.string().min(1),
  })
  .passthrough();

export interface AppVersionService {
  getSystemVersion(
    args?: AppVersionGetSystemVersionArgs,
  ): Promise<SystemVersionResponse>;
}

interface AppVersionGetSystemVersionArgs {
  forceRefresh?: boolean;
}

interface CreateAppVersionServiceArgs {
  config: Pick<ServerRuntimeConfig, "appVersion" | "isDevelopment">;
  fetchImpl?: typeof fetch;
  logger: ServerLogger;
  cacheTtlMs?: number;
  now?: () => number;
}

type NpmDistTag = "latest" | "nightly";

interface NpmLatestRelease {
  distTag: NpmDistTag;
  version: string;
}

interface NpmLatestCacheEntry extends NpmLatestRelease {
  cachedAt: number;
}

export function createAppVersionService(
  args: CreateAppVersionServiceArgs,
): AppVersionService {
  const fetchImpl = args.fetchImpl ?? fetch;
  const cacheTtlMs = args.cacheTtlMs ?? NPM_LATEST_CACHE_TTL_MS;
  const now = args.now ?? (() => Date.now());
  const logger = args.logger;
  const config = args.config;
  const distTag = resolveDistTag(config.appVersion);

  let cache: NpmLatestCacheEntry | null = null;
  let inflight: Promise<NpmLatestRelease | null> | null = null;

  async function fetchNpmDistTag(tag: NpmDistTag): Promise<string | null> {
    const npmDistTagUrl = `${NPM_REGISTRY_PACKAGE_URL}/${tag}`;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(
      () => controller.abort(),
      NPM_LATEST_TIMEOUT_MS,
    );
    try {
      const response = await fetchImpl(npmDistTagUrl, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        logger.warn(
          { status: response.status, url: npmDistTagUrl },
          "Failed to fetch latest bb-app version from npm",
        );
        return null;
      }
      const json = await response.json();
      const parsed = npmLatestResponseSchema.safeParse(json);
      if (!parsed.success) {
        logger.warn(
          { url: npmDistTagUrl, issue: parsed.error.message },
          "npm latest response did not match expected shape",
        );
        return null;
      }
      return parsed.data.version;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(
        { url: npmDistTagUrl, error: message },
        "npm latest lookup failed",
      );
      return null;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  async function fetchNpmLatest(): Promise<NpmLatestRelease | null> {
    if (distTag === "latest") {
      const version = await fetchNpmDistTag("latest");
      return version === null ? null : { distTag: "latest", version };
    }
    const [nightly, latest] = await Promise.all([
      fetchNpmDistTag("nightly"),
      fetchNpmDistTag("latest"),
    ]);
    if (
      latest !== null &&
      semver.valid(latest) !== null &&
      (nightly === null ||
        semver.valid(nightly) === null ||
        semver.gt(latest, nightly))
    ) {
      return { distTag: "latest", version: latest };
    }
    return nightly === null ? null : { distTag: "nightly", version: nightly };
  }

  async function getLatestVersion(args?: {
    forceRefresh?: boolean;
  }): Promise<NpmLatestRelease | null> {
    const currentTime = now();
    if (
      args?.forceRefresh !== true &&
      cache !== null &&
      currentTime - cache.cachedAt < cacheTtlMs
    ) {
      return cache;
    }
    if (inflight !== null) {
      return inflight;
    }
    const requestPromise = (async () => {
      const result = await fetchNpmLatest();
      if (result !== null) {
        cache = { ...result, cachedAt: now() };
      }
      return result;
    })();
    inflight = requestPromise;
    try {
      return await requestPromise;
    } finally {
      if (inflight === requestPromise) {
        inflight = null;
      }
    }
  }

  return {
    async getSystemVersion(
      args: AppVersionGetSystemVersionArgs = {},
    ): Promise<SystemVersionResponse> {
      const baseResponse: SystemVersionResponse = {
        currentVersion: config.appVersion,
        latestVersion: null,
        source: "npm",
        updateAvailable: false,
        isDevelopment: config.isDevelopment,
        upgradeCommand: `npx bb-app@${distTag}`,
      };

      if (config.isDevelopment) {
        return baseResponse;
      }

      const release = await getLatestVersion({
        forceRefresh: args.forceRefresh,
      });
      if (release === null) {
        return baseResponse;
      }
      const latestVersion = release.version;
      const releaseResponse: SystemVersionResponse = {
        ...baseResponse,
        latestVersion,
        upgradeCommand: `npx bb-app@${release.distTag}`,
      };

      const parsedCurrent = semver.parse(config.appVersion);
      const parsedLatest = semver.parse(latestVersion);
      if (parsedCurrent === null || parsedLatest === null) {
        logger.warn(
          {
            currentVersion: config.appVersion,
            latestVersion,
          },
          "Skipping update check because a version is not valid semver",
        );
        return releaseResponse;
      }

      return {
        ...releaseResponse,
        updateAvailable: semver.gt(parsedLatest, parsedCurrent),
      };
    },
  };
}
