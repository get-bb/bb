import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { BbHttpError } from "@bb/sdk/browser";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";
import {
  accumulateRegistryPage,
  describeRegistrySkill,
  resolveInstalledRegistrySkill,
  useProjectSkills,
  useRegistrySkills,
  type RegistrySkillsAccumulator,
} from "@/data/skills";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import {
  Button,
  EmptyStatePanel,
  Input,
  ListRow,
  Pill,
  Skeleton,
  Text,
} from "@/ui";
import { registrySkillDetailHref } from "../shell/hrefs";
import { Screen } from "../shell/Screen";

const SEARCH_DEBOUNCE_MS = 300;

/** skills.sh outages surface as 503 `skills_registry_unavailable`. */
function describeRegistryError(error: unknown): string {
  if (error instanceof BbHttpError && error.status === 503) {
    return "skills.sh is unavailable right now. Try again in a moment.";
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * skills.sh registry browse (`/settings/skills/registry`; web Extensions →
 * Skills → Browse): trending (or all-time, when searching) skills, one page
 * at a time with "Load more"; installed entries are marked. Tap → detail +
 * install.
 */
export function RegistrySkillsScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const trimmed = debouncedQuery.trim();
  const registry = useRegistrySkills({ query: trimmed });
  const library = useProjectSkills(PERSONAL_PROJECT_ID);
  // Flatten the loaded pages; a ranking change mid-scroll (the server can
  // fall back from trending to all-time) restarts the list so the two
  // rankings' `installs` never mix in one list.
  const loaded = useMemo(
    () =>
      (registry.data?.pages ?? []).reduce<RegistrySkillsAccumulator>(
        (current, page) =>
          accumulateRegistryPage(
            current,
            {
              ranking: page.ranking,
              skills: page.skills,
              hasMore: page.pagination.hasMore,
            },
            trimmed,
          ),
        { ranking: "trending", search: trimmed, skills: [], hasMore: false },
      ),
    [registry.data, trimmed],
  );
  const skills = loaded.skills;
  const installed = library.data ?? [];
  const firstPageLoading = registry.isPending && skills.length === 0;

  return (
    <Screen testID="registry-skills-screen">
      <Input
        value={query}
        onChangeText={setQuery}
        placeholder="Search skills.sh"
        autoCapitalize="none"
        clearButtonMode="while-editing"
        testID="registry-skills-search"
      />
      {firstPageLoading ? (
        <View className="gap-3">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </View>
      ) : registry.isError && skills.length === 0 ? (
        <View className="gap-3" testID="registry-skills-unavailable">
          <EmptyStatePanel>
            {describeRegistryError(registry.error)}
          </EmptyStatePanel>
          <Button
            variant="outline"
            icon="RotateCcw"
            onPress={() => void registry.refetch()}
          >
            Retry
          </Button>
        </View>
      ) : skills.length === 0 ? (
        <View testID="registry-skills-empty">
          <EmptyStatePanel>
            {trimmed.length > 0
              ? `No skills match “${trimmed}”.`
              : "No skills listed right now."}
          </EmptyStatePanel>
        </View>
      ) : (
        <View className="gap-1">
          <Text variant="sectionLabel" className="pb-1">
            {loaded.ranking === "trending" ? "Trending" : "All time"}
          </Text>
          <View className="overflow-hidden rounded-lg border border-border bg-card">
            {skills.map((skill) => {
              const installedSkill = resolveInstalledRegistrySkill(
                skill,
                installed,
              );
              return (
                <ListRow
                  key={skill.id}
                  title={skill.name}
                  subtitle={describeRegistrySkill(skill, loaded.ranking)}
                  leading="Zap"
                  trailing={
                    installedSkill ? (
                      <Pill variant="secondary" size="sm">
                        Installed
                      </Pill>
                    ) : (
                      "chevron"
                    )
                  }
                  onPress={() => router.push(registrySkillDetailHref(skill.id))}
                  testID={`registry-skill-row-${skill.skillId}`}
                />
              );
            })}
          </View>
          {registry.hasNextPage ? (
            <Button
              variant="outline"
              className="mt-2"
              loading={registry.isFetchingNextPage}
              onPress={() => void registry.fetchNextPage()}
              testID="registry-skills-load-more"
            >
              Load more
            </Button>
          ) : null}
          {registry.isError ? (
            <Text variant="caption" tone="destructive" className="pt-2">
              {describeRegistryError(registry.error)}
            </Text>
          ) : null}
        </View>
      )}
    </Screen>
  );
}
