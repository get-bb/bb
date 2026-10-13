import { z } from "zod";
import {
  androidAppArtifactSchema,
  type SystemMobileAppReleasesResponse,
} from "@bb/server-contract";

const releaseSchema = z.object({
  assets: z.array(
    z.object({
      name: z.string(),
      size: z.number().int().positive(),
      updated_at: z.iso.datetime(),
      state: z.string(),
    }),
  ),
});

async function readReleases(): Promise<SystemMobileAppReleasesResponse> {
  const signal = AbortSignal.timeout(5000);
  const [manifestResponse, releaseResponse] = await Promise.all([
    fetch(
      "https://github.com/get-bb/bb/releases/download/android-testing/latest.json",
      { signal },
    ),
    fetch(
      "https://api.github.com/repos/get-bb/bb/releases/tags/android-testing",
      {
        signal,
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "bb-mobile-downloads",
        },
      },
    ),
  ]);
  if (!manifestResponse.ok || !releaseResponse.ok) return { android: null };
  const manifest = androidAppArtifactSchema.parse(
    await manifestResponse.json(),
  );
  const release = releaseSchema.parse(await releaseResponse.json());
  const asset = release.assets.find(
    (asset) =>
      asset.name === `${manifest.sha256}.apk` &&
      asset.state === "uploaded" &&
      asset.size === manifest.size,
  );
  if (!asset) return { android: null };
  return { android: { ...manifest, updatedAt: asset.updated_at } };
}

export function createMobileAppReleaseService() {
  let pending: Promise<SystemMobileAppReleasesResponse> | null = null;
  let expiresAt = 0;
  return () => {
    if (!pending || Date.now() >= expiresAt) {
      expiresAt = Date.now() + 5 * 60_000;
      pending = readReleases().catch(() => ({ android: null }));
    }
    return pending;
  };
}
