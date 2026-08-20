import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { BbHttpError } from "@bb/sdk/browser";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Linking, ScrollView, View } from "react-native";
import {
  formatInstallCount,
  formatRegistrySource,
  pickRegistrySkillFile,
  resolveInstalledRegistrySkill,
  useInstallRegistrySkill,
  useProjectSkills,
  useRegistrySkillDetail,
  useRegistrySkillEntry,
} from "@/data/skills";
import { haptic } from "@/lib/haptics";
import { Markdown } from "@/markdown";
import {
  Button,
  EmptyStatePanel,
  ListRow,
  Pill,
  Skeleton,
  Text,
  toast,
} from "@/ui";
import { SettingsSection } from "../plugins/plugin-ui";
import { skillDetailHref } from "../shell/hrefs";
import { Screen } from "../shell/Screen";

function describeError(error: unknown): string {
  if (error instanceof BbHttpError && error.status === 503) {
    return "skills.sh is unavailable right now. Try again in a moment.";
  }
  if (error instanceof BbHttpError && error.status === 404) {
    return "This skill's source is no longer available.";
  }
  return error instanceof Error ? error.message : String(error);
}

function isMarkdownPath(path: string): boolean {
  return /\.(md|mdx|markdown)$/iu.test(path);
}

/**
 * One skills.sh skill (`/settings/skills/registry/[registrySkillId]`; web
 * RegistrySkillDetailView): the entry facts, its files (SKILL.md rendered as
 * markdown, read-only), "Install to my skills" (`POST
 * /skills-registry/install`), and a link to the installed copy once present.
 */
export function RegistrySkillDetailScreen() {
  const params = useLocalSearchParams<{ registrySkillId: string }>();
  const registrySkillId =
    typeof params.registrySkillId === "string" ? params.registrySkillId : null;
  const router = useRouter();
  const entry = useRegistrySkillEntry(registrySkillId);
  const detail = useRegistrySkillDetail({
    source: entry.data?.source ?? null,
    skillId: entry.data?.skillId ?? null,
  });
  const library = useProjectSkills(PERSONAL_PROJECT_ID);
  const install = useInstallRegistrySkill();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const file = useMemo(
    () => pickRegistrySkillFile(detail.data?.files ?? null, selectedPath),
    [detail.data, selectedPath],
  );
  const installedSkill =
    entry.data === undefined
      ? null
      : resolveInstalledRegistrySkill(entry.data, library.data ?? []);
  const title = entry.data?.name ?? "Skill";

  return (
    <>
      <Stack.Screen options={{ title }} />
      <Screen testID="registry-skill-detail-screen">
        {entry.isPending ? (
          <View className="gap-3">
            <Skeleton className="h-8 w-3/5" />
            <Skeleton className="h-32 w-full" />
          </View>
        ) : entry.isError || entry.data === undefined ? (
          <View className="gap-3">
            <EmptyStatePanel>{describeError(entry.error)}</EmptyStatePanel>
            <Button
              variant="outline"
              icon="RotateCcw"
              onPress={() => void entry.refetch()}
            >
              Retry
            </Button>
          </View>
        ) : (
          <>
            <View className="gap-2">
              <Text variant="title" testID="registry-skill-detail-name">
                {entry.data.name}
              </Text>
              <View className="flex-row flex-wrap gap-1.5">
                <Pill variant="secondary" size="sm">
                  {formatRegistrySource(entry.data.source)}
                </Pill>
                <Pill variant="outline" size="sm">
                  {`${formatInstallCount(entry.data.installs)} installs`}
                </Pill>
                {entry.data.stars !== null ? (
                  <Pill
                    variant="outline"
                    size="sm"
                  >{`${formatInstallCount(entry.data.stars)} stars`}</Pill>
                ) : null}
                {entry.data.topic ? (
                  <Pill variant="outline" size="sm">
                    {entry.data.topic}
                  </Pill>
                ) : null}
              </View>
              {entry.data.summary ? (
                <Text variant="body" tone="muted">
                  {entry.data.summary}
                </Text>
              ) : null}
            </View>

            <View className="flex-row gap-2">
              {installedSkill ? (
                <Button
                  icon="Check"
                  variant="secondary"
                  className="flex-1"
                  onPress={() =>
                    router.push(
                      skillDetailHref(installedSkill.id, PERSONAL_PROJECT_ID),
                    )
                  }
                  testID="registry-skill-installed"
                >
                  Installed — open
                </Button>
              ) : (
                <Button
                  icon="Download"
                  className="flex-1"
                  loading={install.isPending}
                  onPress={() =>
                    install.mutate(
                      { registrySkillId: entry.data?.id ?? "" },
                      {
                        onSuccess: (result) => {
                          haptic("success");
                          toast.success(`${title} installed`, {
                            description: result.filePath,
                          });
                        },
                      },
                    )
                  }
                  testID="registry-skill-install"
                >
                  Install to my skills
                </Button>
              )}
              <Button
                variant="outline"
                icon="ExternalLink"
                onPress={() => {
                  Linking.openURL(entry.data?.url ?? "").catch(() =>
                    toast.error("Could not open the link"),
                  );
                }}
                accessibilityLabel="Open on skills.sh"
              >
                skills.sh
              </Button>
            </View>

            {detail.isPending ? (
              <View className="gap-3 rounded-lg border border-border bg-card px-4 py-3">
                <Skeleton className="h-5 w-4/5" />
                <Skeleton className="h-5 w-3/5" />
              </View>
            ) : detail.isError || detail.data === undefined ? (
              <View className="gap-3">
                <EmptyStatePanel>{describeError(detail.error)}</EmptyStatePanel>
                <Button
                  variant="outline"
                  icon="RotateCcw"
                  onPress={() => void detail.refetch()}
                >
                  Retry
                </Button>
              </View>
            ) : file === null ? (
              <EmptyStatePanel>
                This skill has no readable files.
              </EmptyStatePanel>
            ) : (
              <>
                {(detail.data.files?.length ?? 0) > 1 ? (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 8 }}
                  >
                    {(detail.data.files ?? []).map((candidate) => (
                      <Button
                        key={candidate.path}
                        size="sm"
                        variant={
                          candidate.path === file.path ? "default" : "outline"
                        }
                        onPress={() => setSelectedPath(candidate.path)}
                      >
                        {candidate.path}
                      </Button>
                    ))}
                  </ScrollView>
                ) : null}
                <View
                  className="rounded-lg border border-border bg-card px-4 py-3"
                  testID="registry-skill-detail-content"
                >
                  {isMarkdownPath(file.path) ? (
                    <Markdown
                      content={file.contents}
                      textSize="base"
                      showFrontmatter
                    />
                  ) : (
                    <Text variant="mono" className="text-xs" selectable>
                      {file.contents}
                    </Text>
                  )}
                </View>
              </>
            )}

            <SettingsSection title="About">
              <ListRow
                title="Registry id"
                subtitle={entry.data.id}
                leading="Info"
              />
              {entry.data.installUrl ? (
                <ListRow
                  title="Source repository"
                  subtitle={entry.data.installUrl}
                  leading="Github"
                  trailing="chevron"
                  onPress={() => {
                    Linking.openURL(entry.data?.installUrl ?? "").catch(() =>
                      toast.error("Could not open the link"),
                    );
                  }}
                />
              ) : null}
            </SettingsSection>
            <Text variant="caption">
              Treat registry skills as untrusted source material: bb installs
              the files into your user skill library and agents follow them.
            </Text>
          </>
        )}
      </Screen>
    </>
  );
}
