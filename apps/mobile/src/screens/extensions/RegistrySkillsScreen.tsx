import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { BbHttpError } from "@bb/sdk/browser";
import { Stack } from "expo-router";
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
import { Button, EmptyStatePanel, Input, Skeleton, Text } from "@/ui";
import { GroupedScreen } from "../settings/GroupedScreen";
import { LinkRow } from "../settings/LinkRow";
import { SettingsSection } from "../settings/SettingsRows";
import { registrySkillDetailHref } from "../shell/hrefs";

const IS_IOS = process.env.EXPO_OS === "ios";
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
 * install (peekable on iOS). Search lives in the header.
 */
export function RegistrySkillsScreen() {
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
    <>
      {IS_IOS ? (
        <Stack.SearchBar
          placeholder="Search skills.sh"
          autoCapitalize="none"
          hideWhenScrolling={false}
          onChangeText={(event) => setQuery(event.nativeEvent.text)}
          onCancelButtonPress={() => setQuery("")}
        />
      ) : null}
      <GroupedScreen testID="registry-skills-screen">
        {IS_IOS ? null : (
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder="Search skills.sh"
            autoCapitalize="none"
            clearButtonMode="while-editing"
            testID="registry-skills-search"
          />
        )}
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
          <View className="gap-3">
            <SettingsSection
              title={loaded.ranking === "trending" ? "Trending" : "All time"}
              footnote={
                registry.isError ? (
                  <Text variant="footnote" tone="destructive" selectable>
                    {describeRegistryError(registry.error)}
                  </Text>
                ) : undefined
              }
            >
              {skills.map((skill) => {
                const installedSkill = resolveInstalledRegistrySkill(
                  skill,
                  installed,
                );
                return (
                  <LinkRow
                    key={skill.id}
                    href={registrySkillDetailHref(skill.id)}
                    title={skill.name}
                    subtitle={describeRegistrySkill(skill, loaded.ranking)}
                    leading="Zap"
                    value={installedSkill ? "Installed" : undefined}
                    testID={`registry-skill-row-${skill.skillId}`}
                  />
                );
              })}
            </SettingsSection>
            {registry.hasNextPage ? (
              <Button
                variant="outline"
                loading={registry.isFetchingNextPage}
                onPress={() => void registry.fetchNextPage()}
                testID="registry-skills-load-more"
              >
                Load more
              </Button>
            ) : null}
          </View>
        )}
      </GroupedScreen>
    </>
  );
}
