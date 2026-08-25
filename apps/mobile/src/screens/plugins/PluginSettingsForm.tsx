import type { JsonValue } from "@bb/domain";
import type { PluginSettingDescriptor } from "@bb/server-contract";
import { useMemo, useState } from "react";
import { View } from "react-native";
import {
  pluginSecretIsSet,
  pluginSettingFieldValue,
  pluginSettingsChanges,
  usePluginSettings,
  useUpdatePluginSettings,
  type PluginSettingDraft,
} from "@/data/plugins";
import { useSidebarBootstrap } from "@/data/sidebar";
import { haptic } from "@/lib/haptics";
import {
  Button,
  GroupedRow,
  Input,
  Separator,
  Skeleton,
  Switch,
  Text,
  TextArea,
  toast,
} from "@/ui";
import { ProjectPicker } from "../pickers/ProjectPicker";
import { MenuValueRow } from "../settings/MenuValueRow";
import { CardNote } from "./plugin-ui";

/**
 * Host-rendered declarative settings form (web PluginSettingsForm) over
 * `GET/PUT /plugins/:id/settings` as grouped cells: string (incl.
 * write-only secrets, and a monospace multi-line editor for
 * `experimental_multiline`), boolean (switch row), select (a value row
 * opening the option sheet; its rows are `<testID>-option-<value>`),
 * project (the ProjectPicker). Drafts live in local state; Save sends only
 * the changed keys.
 */

function SelectField({
  label,
  description,
  options,
  value,
  disabled,
  onChange,
  testID,
}: {
  label: string;
  description?: string;
  options: readonly string[];
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  testID: string;
}) {
  return (
    <MenuValueRow
      title={label}
      subtitle={description}
      value={value.length > 0 ? value : "Select…"}
      options={options.map((option) => ({ value: option, label: option }))}
      selected={value.length > 0 ? value : null}
      onSelect={onChange}
      disabled={disabled}
      testID={testID}
      accessibilityLabel={label}
    />
  );
}

function ProjectField({
  value,
  onChange,
  testID,
}: {
  value: string;
  onChange: (value: string) => void;
  testID: string;
}) {
  const bootstrap = useSidebarBootstrap();
  const projects = useMemo(
    () =>
      (bootstrap.data?.projects ?? []).map((project) => ({
        id: project.id,
        name: project.name,
      })),
    [bootstrap.data],
  );
  const personal = bootstrap.data?.personalProject ?? null;
  return (
    <ProjectPicker
      projects={projects}
      personalProject={
        personal ? { id: personal.id, name: personal.name } : null
      }
      value={value}
      onChange={onChange}
      loading={bootstrap.isPending}
      testID={testID}
    />
  );
}

function SettingField({
  settingKey,
  descriptor,
  storedValue,
  draft,
  disabled,
  onChange,
}: {
  settingKey: string;
  descriptor: PluginSettingDescriptor;
  storedValue: JsonValue | undefined;
  draft: PluginSettingDraft | undefined;
  disabled: boolean;
  onChange: (value: PluginSettingDraft) => void;
}) {
  const value = pluginSettingFieldValue(descriptor, storedValue, draft);
  const testID = `plugin-setting-${settingKey}`;
  const isSecret = descriptor.type === "string" && descriptor.secret === true;
  const isMultiline =
    descriptor.type === "string" &&
    descriptor.experimental_multiline === true &&
    !isSecret;
  switch (descriptor.type) {
    case "boolean":
      return (
        <GroupedRow
          title={descriptor.label}
          subtitle={descriptor.description}
          titleLines={2}
          trailing={
            <Switch
              checked={value === true}
              onCheckedChange={(next) => onChange(next)}
              disabled={disabled}
              testID={testID}
              accessibilityLabel={descriptor.label}
            />
          }
        />
      );
    case "select":
      return (
        <SelectField
          label={descriptor.label}
          description={descriptor.description}
          options={descriptor.options}
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          onChange={onChange}
          testID={testID}
        />
      );
    case "project":
      return (
        <GroupedRow
          title={descriptor.label}
          subtitle={descriptor.description}
          titleLines={2}
          trailing={
            <ProjectField
              value={typeof value === "string" ? value : ""}
              onChange={onChange}
              testID={testID}
            />
          }
        />
      );
    case "string":
      return (
        <View className="gap-2 px-4 py-2.5">
          <View className="flex-row items-center gap-3">
            <View className="min-w-0 flex-1">
              <Text variant="bodyLarge" numberOfLines={2}>
                {descriptor.label}
              </Text>
              {descriptor.description ? (
                <Text variant="caption">{descriptor.description}</Text>
              ) : null}
            </View>
            {isSecret ? (
              <Text variant="body" tone="muted">
                Secret
              </Text>
            ) : null}
          </View>
          {isMultiline ? (
            <TextArea
              value={typeof value === "string" ? value : ""}
              onChangeText={onChange}
              mono
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              editable={!disabled}
              accessibilityLabel={descriptor.label}
              testID={testID}
              className="max-h-96 min-h-40"
            />
          ) : (
            <Input
              value={typeof value === "string" ? value : ""}
              onChangeText={onChange}
              secureTextEntry={isSecret}
              placeholder={
                isSecret
                  ? pluginSecretIsSet(storedValue)
                    ? "[set] — type to replace"
                    : "[not set]"
                  : undefined
              }
              autoCapitalize="none"
              editable={!disabled}
              accessibilityLabel={descriptor.label}
              testID={testID}
            />
          )}
        </View>
      );
  }
}

interface PluginSettingsFormProps {
  pluginId: string;
}

export function PluginSettingsForm({ pluginId }: PluginSettingsFormProps) {
  const view = usePluginSettings(pluginId);
  const save = useUpdatePluginSettings();
  const [drafts, setDrafts] = useState<Record<string, PluginSettingDraft>>({});

  if (view.isPending) {
    return (
      <View className="gap-3 px-4 py-3">
        <Skeleton className="h-5 w-3/5" />
        <Skeleton className="h-10 w-full" />
      </View>
    );
  }
  if (view.isError || view.data === undefined) {
    return (
      <View className="gap-3 px-4 py-3">
        <Text variant="footnote" tone="destructive" selectable>
          Could not load settings:{" "}
          {view.error instanceof Error ? view.error.message : "unknown error"}
        </Text>
        <Button
          variant="outline"
          size="sm"
          icon="RotateCcw"
          onPress={() => void view.refetch()}
        >
          Retry
        </Button>
      </View>
    );
  }
  const { schema, values } = view.data;
  const entries = Object.entries(schema);
  if (entries.length === 0) {
    return (
      <CardNote testID="plugin-settings-none">
        This plugin has no settings.
      </CardNote>
    );
  }
  const changes = pluginSettingsChanges(schema, values, drafts);
  const hasChanges = Object.keys(changes).length > 0;

  return (
    <View testID="plugin-settings-form">
      {entries.map(([key, descriptor], index) => (
        <View key={key}>
          {index > 0 ? <Separator inset /> : null}
          <SettingField
            settingKey={key}
            descriptor={descriptor}
            storedValue={values[key]}
            draft={drafts[key]}
            disabled={save.isPending}
            onChange={(value) =>
              setDrafts((current) => ({ ...current, [key]: value }))
            }
          />
        </View>
      ))}
      <Separator inset />
      <View className="flex-row items-center justify-end gap-2 px-4 py-2.5">
        {hasChanges ? (
          <Button
            variant="ghost"
            size="sm"
            onPress={() => setDrafts({})}
            disabled={save.isPending}
          >
            Discard
          </Button>
        ) : null}
        <Button
          size="sm"
          disabled={!hasChanges || save.isPending}
          loading={save.isPending}
          onPress={() =>
            save.mutate(
              { pluginId, values: changes },
              {
                onSuccess: () => {
                  haptic("success");
                  setDrafts({});
                  toast.success("Plugin settings saved");
                },
              },
            )
          }
          testID="plugin-settings-save"
        >
          Save settings
        </Button>
      </View>
    </View>
  );
}
