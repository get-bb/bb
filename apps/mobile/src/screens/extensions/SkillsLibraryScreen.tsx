import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";
import {
  filterSkills,
  groupSkillsByScope,
  useProjectSkills,
  type ProviderDisplayNames,
} from "@/data/skills";
import { useSystemProviders } from "@/data/system";
import { describeError } from "@/lib/describe-error";
import {
  Button,
  EmptyStatePanel,
  Input,
  ListRow,
  Pill,
  Skeleton,
  Text,
} from "@/ui";
import { SettingsSection } from "../plugins/plugin-ui";
import { registrySkillsHref, skillDetailHref } from "../shell/hrefs";
import { Screen } from "../shell/Screen";

/**
 * Skill rows carry only a provider id (open-ended: every custom ACP agent is
 * one); the server roster turns them into names.
 */
export function useProviderDisplayNames(): ProviderDisplayNames {
  const providers = useSystemProviders().data;
  return useMemo(
    () =>
      new Map(
        (providers ?? []).map((provider) => [
          provider.id,
          provider.displayName,
        ]),
      ),
    [providers],
  );
}

/**
 * The skills library (`/settings/skills`; web Extensions → Skills → My
 * skills): every skill the personal project's default workspace discovers
 * (user / built-in / provider / plugin scopes), grouped by scope, with a
 * filter and the registry browse entry point. Read-only here; tap → detail.
 */
export function SkillsLibraryScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const skills = useProjectSkills(PERSONAL_PROJECT_ID);
  const providerNames = useProviderDisplayNames();
  const groups = useMemo(
    () =>
      groupSkillsByScope(filterSkills(skills.data ?? [], query), providerNames),
    [providerNames, query, skills.data],
  );
  const total = skills.data?.length ?? 0;

  return (
    <Screen testID="skills-screen">
      <SettingsSection title="Discover">
        <ListRow
          title="Browse skills.sh"
          subtitle="Install community skills into your library"
          leading="Explore"
          trailing="chevron"
          onPress={() => router.push(registrySkillsHref())}
          testID="skills-browse"
        />
      </SettingsSection>

      <View className="gap-1">
        <Text variant="sectionLabel" className="pb-1">
          {total > 0 ? `My skills (${total})` : "My skills"}
        </Text>
        {total > 6 ? (
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder="Filter skills"
            autoCapitalize="none"
            clearButtonMode="while-editing"
            className="mb-2"
            testID="skills-filter"
          />
        ) : null}
        {skills.isPending ? (
          <View className="gap-3 rounded-lg border border-border bg-card px-4 py-3">
            <Skeleton className="h-5 w-3/5" />
            <Skeleton className="h-5 w-2/5" />
          </View>
        ) : skills.isError ? (
          <View className="gap-3 rounded-lg border border-border bg-card px-4 py-3">
            <Text variant="caption" tone="destructive">
              Could not load skills: {describeError(skills.error)}
            </Text>
            <Button
              variant="outline"
              size="sm"
              icon="RotateCcw"
              onPress={() => void skills.refetch()}
            >
              Retry
            </Button>
          </View>
        ) : total === 0 ? (
          <View testID="skills-empty">
            <EmptyStatePanel>
              No skills yet. Agents read SKILL.md files from your bb and
              provider skill folders; install one from skills.sh to start.
            </EmptyStatePanel>
          </View>
        ) : groups.length === 0 ? (
          <EmptyStatePanel>No skills match “{query}”.</EmptyStatePanel>
        ) : (
          <View className="gap-4">
            {groups.map((group) => (
              <View
                key={group.key}
                className="gap-1"
                testID={`skills-group-${group.key}`}
              >
                <Text variant="caption" className="px-1">
                  {group.label}
                </Text>
                <View className="overflow-hidden rounded-lg border border-border bg-card">
                  {group.skills.map((skill) => (
                    <ListRow
                      key={skill.id}
                      title={skill.name}
                      subtitle={skill.description ?? undefined}
                      leading="Zap"
                      trailing={
                        skill.registrySkillId !== null ? (
                          <Pill variant="outline" size="sm">
                            skills.sh
                          </Pill>
                        ) : (
                          "chevron"
                        )
                      }
                      onPress={() =>
                        router.push(
                          skillDetailHref(skill.id, PERSONAL_PROJECT_ID),
                        )
                      }
                      testID={`skill-row-${skill.name}`}
                    />
                  ))}
                </View>
              </View>
            ))}
          </View>
        )}
      </View>
    </Screen>
  );
}
