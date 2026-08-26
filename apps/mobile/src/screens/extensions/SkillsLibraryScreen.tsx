import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { SkillSummary } from "@bb/server-contract";
import { Stack, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";
import {
  filterSkills,
  groupSkillsByScope,
  isSkillDeletable,
  useDeleteSkill,
  useProjectSkills,
  type ProviderDisplayNames,
} from "@/data/skills";
import { useSystemProviders } from "@/data/system";
import { describeError } from "@/lib/describe-error";
import { haptic } from "@/lib/haptics";
import {
  ActionSheet,
  Button,
  confirmDestructive,
  EmptyStatePanel,
  Input,
  Skeleton,
  Text,
  toast,
  useSheet,
  type ActionSheetAction,
} from "@/ui";
import { GroupedScreen } from "../settings/GroupedScreen";
import { LinkRow } from "../settings/LinkRow";
import { useBadgeColors } from "../settings/settings-badges";
import { SettingsSection } from "../settings/SettingsRows";
import { registrySkillsHref, skillDetailHref } from "../shell/hrefs";

const IS_IOS = process.env.EXPO_OS === "ios";

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
 * header search bar and the registry browse entry point. Tap → detail;
 * the long-press action sheet (both platforms) deletes user-owned skills.
 */
export function SkillsLibraryScreen() {
  const router = useRouter();
  const colors = useBadgeColors();
  const [query, setQuery] = useState("");
  const skills = useProjectSkills(PERSONAL_PROJECT_ID);
  const providerNames = useProviderDisplayNames();
  const deleteSkill = useDeleteSkill();
  const menu = useSheet();
  const [target, setTarget] = useState<SkillSummary | null>(null);
  const groups = useMemo(
    () =>
      groupSkillsByScope(filterSkills(skills.data ?? [], query), providerNames),
    [providerNames, query, skills.data],
  );
  const total = skills.data?.length ?? 0;

  const confirmDelete = (skill: SkillSummary) =>
    confirmDestructive({
      title: `Delete ${skill.name}?`,
      message:
        "The skill folder is deleted from the machine. This cannot be undone.",
      actionLabel: "Delete skill",
      onConfirm: () =>
        deleteSkill.mutate(
          { projectId: PERSONAL_PROJECT_ID, skillId: skill.id },
          { onSuccess: () => toast.success(`${skill.name} deleted`) },
        ),
    });

  const actionsFor = (skill: SkillSummary): ActionSheetAction[] => [
    {
      key: "open",
      label: "Open",
      icon: "ChevronRight",
      onPress: () =>
        router.push(skillDetailHref(skill.id, PERSONAL_PROJECT_ID)),
    },
    ...(isSkillDeletable(skill)
      ? [
          {
            key: "delete",
            label: "Delete skill",
            icon: "Trash2" as const,
            destructive: true,
            onPress: () => confirmDelete(skill),
          },
        ]
      : []),
  ];

  return (
    <>
      {IS_IOS ? (
        <Stack.SearchBar
          placeholder="Search skills"
          autoCapitalize="none"
          hideWhenScrolling={false}
          onChangeText={(event) => setQuery(event.nativeEvent.text)}
          onCancelButtonPress={() => setQuery("")}
        />
      ) : null}
      <GroupedScreen testID="skills-screen">
        <SettingsSection title="Discover">
          <LinkRow
            href={registrySkillsHref()}
            title="Browse skills.sh"
            subtitle="Install community skills into your library"
            badge={{ icon: "Explore", symbol: "book.fill", color: colors.pink }}
            testID="skills-browse"
          />
        </SettingsSection>

        {IS_IOS ? null : (
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder="Search skills"
            autoCapitalize="none"
            clearButtonMode="while-editing"
            testID="skills-filter"
          />
        )}

        <View className="gap-4">
          <Text variant="heading" className="px-4">
            {total > 0 ? `My skills (${total})` : "My skills"}
          </Text>
          {skills.isPending ? (
            <SettingsSection>
              <View className="gap-3 px-4 py-3">
                <Skeleton className="h-5 w-3/5" />
                <Skeleton className="h-5 w-2/5" />
              </View>
            </SettingsSection>
          ) : skills.isError ? (
            <SettingsSection>
              <View className="gap-3 px-4 py-3">
                <Text variant="footnote" tone="destructive" selectable>
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
            </SettingsSection>
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
            groups.map((group) => (
              <SettingsSection
                key={group.key}
                title={group.label}
                testID={`skills-group-${group.key}`}
              >
                {group.skills.map((skill) => (
                  <LinkRow
                    key={skill.id}
                    href={skillDetailHref(skill.id, PERSONAL_PROJECT_ID)}
                    title={skill.name}
                    subtitle={skill.description ?? undefined}
                    leading="Zap"
                    value={
                      skill.registrySkillId !== null ? "skills.sh" : undefined
                    }
                    onLongPress={() => {
                      haptic("impact-heavy");
                      setTarget(skill);
                      menu.present();
                    }}
                    testID={`skill-row-${skill.name}`}
                  />
                ))}
              </SettingsSection>
            ))
          )}
        </View>
      </GroupedScreen>

      <ActionSheet
        controller={menu}
        title={target?.name}
        message={target?.description ?? undefined}
        actions={target ? actionsFor(target) : []}
      />
    </>
  );
}
