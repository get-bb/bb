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
  ActionSheet,
  Button,
  EmptyStatePanel,
  ListRow,
  Pill,
  Skeleton,
  Text,
  toast,
  useSheet,
} from "@/ui";
import { SettingsSection } from "../plugins/plugin-ui";
import { Screen } from "../shell/Screen";
import { useProviderDisplayNames } from "./SkillsLibraryScreen";

const SKILL_MAIN_FILE = "SKILL.md";

function isMarkdownPath(path: string): boolean {
  return /\.(md|mdx|markdown)$/iu.test(path);
}

/**
 * One library skill, read-only (`/settings/skills/[skillId]?projectId=`;
 * web SkillDetailDialogView): scope + description, the skill folder's files
 * as a chip strip, SKILL.md rendered as markdown (other files as mono
 * text), copy path, and Delete for user-owned local skills.
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
  const confirmDelete = useSheet();

  const fileList = files.data?.files ?? [SKILL_MAIN_FILE];
  const title = skill?.name ?? "Skill";

  return (
    <>
      <Stack.Screen options={{ title }} />
      <Screen testID="skill-detail-screen">
        {isPending ? (
          <View className="gap-3">
            <Skeleton className="h-8 w-3/5" />
            <Skeleton className="h-32 w-full" />
          </View>
        ) : isError ? (
          <View className="gap-3">
            <Text variant="caption" tone="destructive">
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
            <View className="gap-2">
              <Text variant="title" testID="skill-detail-name">
                {skill.name}
              </Text>
              <View className="flex-row flex-wrap gap-1.5">
                <Pill variant="secondary" size="sm">
                  {skillScopeLabel(
                    skill,
                    skill.provider === null
                      ? undefined
                      : providerNames.get(skill.provider),
                  )}
                </Pill>
                {skill.registrySkillId !== null ? (
                  <Pill variant="outline" size="sm">
                    skills.sh
                  </Pill>
                ) : null}
                {skill.pluginId !== null ? (
                  <Pill
                    variant="outline"
                    size="sm"
                  >{`plugin · ${skill.pluginId}`}</Pill>
                ) : null}
              </View>
              {skill.description ? (
                <Text variant="body" tone="muted">
                  {skill.description}
                </Text>
              ) : null}
            </View>

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

            <View
              className="rounded-lg border border-border bg-card px-4 py-3"
              testID="skill-detail-content"
            >
              {content.isPending ? (
                <View className="gap-3">
                  <Skeleton className="h-5 w-4/5" />
                  <Skeleton className="h-5 w-3/5" />
                  <Skeleton className="h-5 w-2/3" />
                </View>
              ) : content.isError ? (
                <View className="gap-3">
                  <Text variant="caption" tone="destructive">
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

            <SettingsSection title="Location">
              <ListRow
                title="SKILL.md path"
                subtitle={skill.filePath}
                leading="File"
                onPress={() => copyWithToast(skill.filePath, "Path copied")}
                testID="skill-detail-path"
              />
              {isSkillDeletable(skill) ? (
                <ListRow
                  title="Delete skill"
                  subtitle="Removes the installed skill folder"
                  leading="Trash2"
                  destructive
                  onPress={confirmDelete.present}
                  testID="skill-detail-delete"
                />
              ) : null}
            </SettingsSection>
          </>
        )}
      </Screen>

      <ActionSheet
        controller={confirmDelete}
        title={skill ? `Delete ${skill.name}?` : undefined}
        message="The skill folder is deleted from the machine. This cannot be undone."
        actions={
          skill
            ? [
                {
                  key: "confirm-delete",
                  label: "Delete skill",
                  icon: "Trash2",
                  destructive: true,
                  onPress: () =>
                    deleteSkill.mutate(
                      { projectId, skillId: skill.id },
                      {
                        onSuccess: () => {
                          toast.success(`${skill.name} deleted`);
                          router.back();
                        },
                      },
                    ),
                },
              ]
            : []
        }
      />
    </>
  );
}
