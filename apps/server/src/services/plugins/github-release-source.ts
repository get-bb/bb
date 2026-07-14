const GITHUB_RELEASE_SOURCE_MARKER = "bb-source";
const GITHUB_RELEASE_SOURCE_VALUE = "github-release";

export interface GithubReleaseSourceConfig {
  repository: string;
  tagTemplate: string;
  assetTemplate: string;
  bbEngineRange: string | undefined;
  pluginSdkEngineRange: string | undefined;
}

function assertTemplate(value: string, label: string): void {
  if (value.split("{version}").length !== 2) {
    throw new Error(`${label} must contain {version} exactly once`);
  }
}

export function githubReleaseRegistryUrl(
  config: GithubReleaseSourceConfig,
): string {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(config.repository)) {
    throw new Error(
      `invalid GitHub release repository ${JSON.stringify(config.repository)}`,
    );
  }
  assertTemplate(config.tagTemplate, "GitHub release tagTemplate");
  assertTemplate(config.assetTemplate, "GitHub release assetTemplate");
  const url = new URL(
    `https://api.github.com/repos/${config.repository}/releases`,
  );
  url.searchParams.set(
    GITHUB_RELEASE_SOURCE_MARKER,
    GITHUB_RELEASE_SOURCE_VALUE,
  );
  url.searchParams.set("tag-template", config.tagTemplate);
  url.searchParams.set("asset-template", config.assetTemplate);
  if (config.bbEngineRange !== undefined) {
    url.searchParams.set("engines-bb", config.bbEngineRange);
  }
  if (config.pluginSdkEngineRange !== undefined) {
    url.searchParams.set("engines-bb-plugin-sdk", config.pluginSdkEngineRange);
  }
  return url.toString();
}

export function parseGithubReleaseRegistryUrl(
  value: string,
): GithubReleaseSourceConfig | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "api.github.com" ||
    url.searchParams.get(GITHUB_RELEASE_SOURCE_MARKER) !==
      GITHUB_RELEASE_SOURCE_VALUE
  ) {
    return null;
  }
  const match = url.pathname.match(
    /^\/repos\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/releases\/?$/u,
  );
  const tagTemplate = url.searchParams.get("tag-template");
  const assetTemplate = url.searchParams.get("asset-template");
  if (match === null || tagTemplate === null || assetTemplate === null) {
    return null;
  }
  try {
    assertTemplate(tagTemplate, "GitHub release tagTemplate");
    assertTemplate(assetTemplate, "GitHub release assetTemplate");
  } catch {
    return null;
  }
  return {
    repository: `${match[1]}/${match[2]}`,
    tagTemplate,
    assetTemplate,
    bbEngineRange: url.searchParams.get("engines-bb") ?? undefined,
    pluginSdkEngineRange:
      url.searchParams.get("engines-bb-plugin-sdk") ?? undefined,
  };
}

export function githubReleaseApiUrl(repository: string, page: number): string {
  const url = new URL(`https://api.github.com/repos/${repository}/releases`);
  url.searchParams.set("per_page", "100");
  url.searchParams.set("page", String(page));
  return url.toString();
}

export function templateVersion(
  template: string,
  value: string,
): string | null {
  const [prefix, suffix] = template.split("{version}");
  if (
    prefix === undefined ||
    suffix === undefined ||
    !value.startsWith(prefix) ||
    !value.endsWith(suffix) ||
    value.length <= prefix.length + suffix.length
  ) {
    return null;
  }
  return value.slice(prefix.length, value.length - suffix.length);
}

export function applyVersionTemplate(
  template: string,
  version: string,
): string {
  return template.replace("{version}", version);
}
