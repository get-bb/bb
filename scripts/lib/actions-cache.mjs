export function cacheFamily(key) {
  const pnpm =
    /^(node-cache-(?:Linux|macOS|Windows)-(?:x64|arm64)-pnpm)-[a-f0-9]{64}$/u.exec(
      key,
    );
  if (pnpm) return pnpm[1];
  if (key.includes("turbo-")) return "turbo";
  return "other";
}

export function cacheCleanupPlan(
  caches,
  { currentHash, defaultRef, closedRefs, now },
) {
  const groups = new Map();
  for (const cache of caches) {
    const family = cacheFamily(cache.key);
    if (!family.startsWith("node-cache-")) continue;
    const group = `${family}:${cache.ref}`;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(cache);
  }
  const deletions = [];
  for (const entries of groups.values()) {
    entries.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    for (const [index, cache] of entries.entries()) {
      const idleDays = (now - Date.parse(cache.last_accessed_at)) / 86_400_000;
      const ageDays = (now - Date.parse(cache.created_at)) / 86_400_000;
      if (closedRefs.has(cache.ref) && Math.min(idleDays, ageDays) >= 1) {
        deletions.push(cache);
      } else if (
        cache.ref === defaultRef &&
        index >= 2 &&
        !cache.key.endsWith(`-${currentHash}`) &&
        Math.min(idleDays, ageDays) >= 3
      ) {
        deletions.push(cache);
      }
    }
  }
  return deletions;
}

export function actionsApi() {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repository || !token)
    throw new Error("GITHUB_REPOSITORY and GITHUB_TOKEN are required");
  const root = `${process.env.GITHUB_API_URL ?? "https://api.github.com"}/repos/${repository}`;
  return async (path, method = "GET") => {
    const response = await fetch(`${root}/${path}`, {
      method,
      signal: AbortSignal.timeout(10_000),
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
      },
    });
    if (!response.ok)
      throw new Error(`Actions API ${method} ${path}: HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  };
}

export async function listActionsCaches(api) {
  const caches = new Map();
  for (let page = 1; page <= 100; page++) {
    const result = await api(`actions/caches?per_page=100&page=${page}`);
    if (!Array.isArray(result?.actions_caches))
      throw new Error("Invalid Actions cache inventory");
    for (const cache of result.actions_caches) {
      if (
        !Number.isSafeInteger(cache.id) ||
        cache.id <= 0 ||
        typeof cache.key !== "string" ||
        typeof cache.ref !== "string" ||
        !Number.isSafeInteger(cache.size_in_bytes) ||
        cache.size_in_bytes < 0 ||
        typeof cache.created_at !== "string" ||
        typeof cache.last_accessed_at !== "string" ||
        !Number.isFinite(Date.parse(cache.created_at)) ||
        !Number.isFinite(Date.parse(cache.last_accessed_at))
      ) {
        throw new Error("Invalid Actions cache entry");
      }
      caches.set(cache.id, cache);
    }
    if (result.actions_caches.length < 100) return [...caches.values()];
  }
  throw new Error(
    "Actions cache inventory exceeded pagination limit; refusing partial cleanup",
  );
}

export function cacheUsageTable(caches) {
  const families = new Map();
  for (const cache of caches) {
    const family = cacheFamily(cache.key);
    const group = families.get(family) ?? { count: 0, bytes: 0 };
    group.count++;
    group.bytes += cache.size_in_bytes;
    families.set(family, group);
  }
  return [
    "| Cache family | Entries | GiB |",
    "| --- | ---: | ---: |",
    ...[...families]
      .sort((a, b) => b[1].bytes - a[1].bytes)
      .map(
        ([family, value]) =>
          `| ${family} | ${value.count} | ${(value.bytes / 1024 ** 3).toFixed(2)} |`,
      ),
    "",
    "This inventory covers GitHub-visible caches; Blacksmith-managed storage may differ.",
  ].join("\n");
}
