import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import {
  isSkillDeletable,
  skillScopeLabel,
  useDeleteSkill,
  useProjectSkill,
  useSkillContent,
  useSkillFiles,
} from "@/data/skills";
import { copyWithToast } from "@/lib/clipboard";
import { Markdown } from "@/markdown";
import {
  Button,
  confirmDestructive,
  EmptyStatePanel,
  GroupedRow,
  IconBadge,
  Skeleton,
  Text,
  toast,
} from "@/ui";
import { GroupedScreen } from "../settings/GroupedScreen";
import { useBadgeColors } from "../settings/settings-badges";
import { SettingsSection } from "../settings/SettingsRows";
import { useProviderDisplayNames } from "./SkillsLibraryScreen";

const SKILL_MAIN_FILE = "SKILL.md";

function isMarkdownPath(path: string): boolean {
  return /\.(md|mdx|markdown)$/iu.test(path);
}

/**
 * One library skill, read-only (`/settings/skills/[skillId]?projectId=`;
 * web SkillDetailDialogView): the identity cell with scope and description,
 * the skill folder's files as a chip strip, SKILL.md rendered as markdown
 * (other files as mono text), copy path, and Delete for user-owned local
 * skills.
 */
export function SkillDetailScreen() {
  const params = useLocalSearchParams<{
    skillId: string;
    projectId?: string;
  }>();
  const skillId = typeof params.skillId === "string" ? params.skillId : null;
  const projectId =
    typeof params.projectId === "string" && params.projectId.length > 0
      ? params.projectId
      : PERSONAL_PROJECT_ID;
  const router = useRouter();
  const colors = useBadgeColors();
  const providerNames = useProviderDisplayNames();
  const { skill, isPending, isError, error, refetch } = useProjectSkill(
    projectId,
    skillId,
  );
  // The picked file is scoped to the skill it was picked for, so navigating
  // to another skill starts at SKILL.md again without an effect.
  const [selection, setSelection] = useState<{
    skillId: string | null;
    path: string;
  }>({ skillId, path: SKILL_MAIN_FILE });
  const selectedPath =
    selection.skillId === skillId ? selection.path : SKILL_MAIN_FILE;
  const setSelectedPath = (path: string) => setSelection({ skillId, path });
  const files = useSkillFiles({ projectId, skillId });
  const content = useSkillContent({ projectId, skillId, path: selectedPath });
  const deleteSkill = useDeleteSkill();

  const fileList = files.data?.files ?? [SKILL_MAIN_FILE];
  const title = skill?.name ?? "Skill";

  const confirmDelete = () => {
    if (!skill) return;
    confirmDestructive({
      title: `Delete ${skill.name}?`,
      message:
        "The skill folder is deleted from the machine. This cannot be undone.",
      actionLabel: "Delete skill",
      onConfirm: () =>
        deleteSkill.mutate(
          { projectId, skillId: skill.id },
          {
            onSuccess: () => {
              toast.success(`${skill.name} deleted`);
              router.back();
            },
          },
        ),
    });
  };

  return (
    <>
      <Stack.Screen options={{ title }} />
      <GroupedScreen testID="skill-detail-screen">
        {isPending ? (
          <View className="gap-3">
            <Skeleton className="h-8 w-3/5" />
            <Skeleton className="h-32 w-full" />
          </View>
        ) : isError ? (
          <View className="gap-3">
            <Text variant="footnote" tone="destructive" selectable>
              Could not load the skill:{" "}
              {error instanceof Error ? error.message : String(error)}
            </Text>
            <Button
              variant="outline"
              icon="RotateCcw"
              onPress={() => void refetch()}
            >
              Retry
            </Button>
          </View>
        ) : skill === null ? (
          <EmptyStatePanel>
            This skill is no longer in the library.
          </EmptyStatePanel>
        ) : (
          <>
            <SettingsSection footnote={skill.description ?? undefined}>
              <View className="flex-row items-center gap-3 px-4 py-3">
                <IconBadge
                  icon="AiContentGenerator01"
                  symbol="sparkles"
                  color={colors.pink}
                  size={40}
                />
                <View className="min-w-0 flex-1">
                  <Text
                    variant="headline"
                    numberOfLines={2}
                    selectable
                    testID="skill-detail-name"
                  >
                    {skill.name}
                  </Text>
                  <Text variant="caption" numberOfLines={2}>
                    {[
                      skillScopeLabel(
                        skill,
                        skill.provider === null
                          ? undefined
                          : providerNames.get(skill.provider),
                      ),
                      skill.registrySkillId !== null ? "skills.sh" : null,
                      skill.pluginId !== null
                        ? `plugin · ${skill.pluginId}`
                        : null,
                    ]
                      .filter((part): part is string => part !== null)
                      .join(" · ")}
                  </Text>
                </View>
              </View>
            </SettingsSection>

            {fileList.length > 1 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8 }}
              >
                {fileList.map((path) => (
                  <Button
                    key={path}
                    size="sm"
                    variant={path === selectedPath ? "default" : "outline"}
                    onPress={() => setSelectedPath(path)}
                    testID={`skill-file-${path}`}
                  >
                    {path}
                  </Button>
                ))}
              </ScrollView>
            ) : null}

            <SettingsSection title={selectedPath}>
              <View className="px-4 py-3" testID="skill-detail-content">
                {content.isPending ? (
                  <View className="gap-3">
                    <Skeleton className="h-5 w-4/5" />
                    <Skeleton className="h-5 w-3/5" />
                    <Skeleton className="h-5 w-2/3" />
                  </View>
                ) : content.isError ? (
                  <View className="gap-3">
                    <Text variant="footnote" tone="destructive" selectable>
                      Could not read {selectedPath}:{" "}
                      {content.error instanceof Error
                        ? content.error.message
                        : String(content.error)}
                    </Text>
                    <Button
                      variant="outline"
                      size="sm"
                      icon="RotateCcw"
                      onPress={() => void content.refetch()}
                    >
                      Retry
                    </Button>
                  </View>
                ) : isMarkdownPath(selectedPath) ? (
                  <Markdown
                    content={content.data?.content ?? ""}
                    textSize="base"
                    showFrontmatter
                  />
                ) : (
                  <Text variant="mono" className="text-xs" selectable>
                    {content.data?.content ?? ""}
                  </Text>
                )}
              </View>
            </SettingsSection>

            <SettingsSection title="Location">
              <GroupedRow
                title="SKILL.md path"
                subtitle={skill.filePath}
                leading="File"
                onPress={() => copyWithToast(skill.filePath, "Path copied")}
                accessibilityHint="Copies the path"
                testID="skill-detail-path"
              />
              {isSkillDeletable(skill) ? (
                <GroupedRow
                  title="Delete skill"
                  subtitle="Removes the installed skill folder"
                  leading="Trash2"
                  destructive
                  onPress={confirmDelete}
                  testID="skill-detail-delete"
                />
              ) : null}
            </SettingsSection>
          </>
        )}
      </GroupedScreen>
    </>
  );
}
