import { useQuery } from "@tanstack/react-query";
import { matchPath } from "react-router-dom";
import type {
  ExperimentalPageTitle,
  PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";
import { usePluginList } from "@/hooks/queries/plugin-settings-queries";
import { usePluginCatalogSearch } from "@/hooks/queries/plugin-catalog-queries";
import { projectSkillsQueryKey } from "@/hooks/queries/query-keys";
import { sdk } from "@/lib/sdk";
import { fetchRegistrySkillEntry } from "@/lib/skills-registry";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import {
  PLUGIN_DETAIL_ROUTE_PATH,
  SKILL_DETAIL_ROUTE_PATH,
  REGISTRY_SKILL_DETAIL_ROUTE_PATH,
} from "@/lib/route-paths";
import { resolveToolsBreadcrumbs } from "@/components/tools/tools-navigation";
import { pluginDetailKeyFromRoute } from "@/components/plugin/plugin-detail-key";
import { resolvePluginDetailKey } from "@/components/plugin/management/installed-plugin-catalog";
import { pluginBrowseShelves } from "@/components/plugin/management/plugin-browse-discovery";

function routeParameter(pattern: string, key: string, pathname: string) {
  const value = matchPath(pattern, pathname)?.params[key];
  if (value === undefined) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function useCorePageTitle({
  subPath,
}: PluginNavPanelProps): ExperimentalPageTitle | null {
  const { pathname, search } = new URL(subPath, "http://bb.local");
  const pluginId = routeParameter(
    PLUGIN_DETAIL_ROUTE_PATH,
    "pluginId",
    pathname,
  );
  const skillId = routeParameter(SKILL_DETAIL_ROUTE_PATH, "skillId", pathname);
  const registrySkillId = routeParameter(
    REGISTRY_SKILL_DETAIL_ROUTE_PATH,
    "registrySkillId",
    pathname,
  );
  const plugins = usePluginList({ enabled: pluginId !== undefined });
  const shelfKey = new URLSearchParams(search).get("shelf");
  const catalog = usePluginCatalogSearch("", {
    enabled: pluginId !== undefined || shelfKey !== null,
  });
  const skills = useQuery({
    queryKey: projectSkillsQueryKey(PERSONAL_PROJECT_ID),
    queryFn: ({ signal }) =>
      sdk.skills.list({
        projectId: PERSONAL_PROJECT_ID,
        environmentId: null,
        signal,
      }),
    enabled: skillId !== undefined,
  });
  const registryEntry = useQuery({
    queryKey: ["skills-registry-entry", registrySkillId ?? "none"],
    queryFn: ({ signal }) => fetchRegistrySkillEntry(registrySkillId!, signal),
    enabled: registrySkillId !== undefined,
  });
  const detail = pluginId
    ? resolvePluginDetailKey(
        pluginDetailKeyFromRoute(pluginId, search),
        plugins.data?.plugins ?? [],
        catalog.data?.entries ?? [],
        { allowSourceFallback: false },
      )
    : null;
  const label =
    detail?.plugin?.name ??
    detail?.plugin?.id ??
    detail?.entry?.displayName ??
    skills.data?.skills.find((skill) => skill.id === skillId)?.name ??
    registryEntry.data?.name;
  const breadcrumbs = resolveToolsBreadcrumbs(pathname, search, label);
  if (!breadcrumbs) return null;
  const shelf =
    shelfKey && catalog.data
      ? pluginBrowseShelves({
          ...catalog.data,
          entries: catalog.data.entries.filter((entry) => entry.compatible),
        }).find((shelf) => shelf.key === shelfKey)
      : null;
  const trail = breadcrumbs.slice(1);
  if (shelf && trail.length === 1) trail.push({ label: shelf.label });
  const sectionLabel = breadcrumbs[0]?.label ?? "BB";
  const leaf = trail.at(-1)?.label ?? sectionLabel;
  return {
    ...(trail.length === 1 ? { title: leaf } : { breadcrumbs: trail }),
    windowTitle:
      leaf === sectionLabel ? sectionLabel : `${leaf} · ${sectionLabel}`,
  };
}
