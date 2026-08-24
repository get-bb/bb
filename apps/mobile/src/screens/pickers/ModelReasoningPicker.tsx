import type { ReasoningLevel } from "@bb/domain";
import { useState } from "react";
import { Pressable, View } from "react-native";
import {
  formatModelLabel,
  type ModelPickerOption,
  type ReasoningPickerOption,
} from "@/data/compose";
import { useTheme } from "@/theme";
import {
  cn,
  Icon,
  ListRow,
  Separator,
  Sheet,
  Spinner,
  Switch,
  Text,
  useSheet,
} from "@/ui";
import { filterModelOptions, showModelSearch } from "./model-picker-model";
import { usePickerSheetMaxHeight } from "./OptionSheet";
import { PickerTrigger } from "./PickerTrigger";
import { SheetInput } from "./SheetInput";

export interface ModelReasoningPickerProps {
  /** Fresh picker choices (a retired-but-selected model already promoted). */
  modelOptions: readonly ModelPickerOption[];
  /** Retired/legacy models behind the "More models" disclosure. */
  moreModelOptions: readonly ModelPickerOption[];
  /** The model id that will run ("" while unknown). */
  modelValue: string;
  onModelChange: (model: string) => void;
  reasoningOptions: readonly ReasoningPickerOption[];
  reasoningValue: ReasoningLevel;
  onReasoningChange: (level: ReasoningLevel) => void;
  /** Service tier "Fast" toggle; omit when the provider does not support it. */
  fastMode?: {
    enabled: boolean;
    onChange: (enabled: boolean) => void;
  };
  isLoading?: boolean;
  /** The model probe failed; the picker shows the message and keeps the value. */
  loadErrorMessage?: string | null;
  disabled?: boolean;
}

/**
 * Model + reasoning effort (+ Fast) in one sheet, mirroring the web
 * ModelReasoningPicker's essentials: model rows with a check mark, a
 * "More models" disclosure for retired ids, reasoning chips per model, and
 * the service-tier switch.
 */
export function ModelReasoningPicker({
  modelOptions,
  moreModelOptions,
  modelValue,
  onModelChange,
  reasoningOptions,
  reasoningValue,
  onReasoningChange,
  fastMode,
  isLoading = false,
  loadErrorMessage = null,
  disabled,
}: ModelReasoningPickerProps) {
  const sheet = useSheet();
  const { tokens } = useTheme();
  const maxHeight = usePickerSheetMaxHeight();
  const [showMore, setShowMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const selectedModel =
    modelOptions.find((option) => option.value === modelValue) ??
    moreModelOptions.find((option) => option.value === modelValue);
  const modelLabel =
    selectedModel?.label ??
    (modelValue
      ? formatModelLabel(modelValue)
      : isLoading
        ? "Loading…"
        : "Model");
  const reasoningLabel = reasoningOptions.find(
    (option) => option.value === reasoningValue,
  )?.label;
  const showReasoning = reasoningOptions.length > 0;
  const hasModels = modelOptions.length > 0 || moreModelOptions.length > 0;
  const triggerLabel = fastMode?.enabled ? `${modelLabel} · Fast` : modelLabel;
  // Long catalogs (Pi routing to OpenRouter, local providers, …) get a search
  // field; short ones stay a plain list. Filtering flattens the retired models
  // inline so every match stays reachable.
  const showSearch =
    hasModels &&
    !loadErrorMessage &&
    showModelSearch(modelOptions, moreModelOptions);
  const filtered = filterModelOptions(
    modelOptions,
    moreModelOptions,
    showSearch ? searchQuery : "",
  );
  const visibleMoreOptions = filtered.isSearching
    ? filtered.moreModelOptions
    : showMore
      ? moreModelOptions
      : [];
  const noMatches =
    filtered.isSearching &&
    filtered.modelOptions.length === 0 &&
    filtered.moreModelOptions.length === 0;

  return (
    <>
      <PickerTrigger
        icon="Brain"
        label={triggerLabel}
        detail={showReasoning ? reasoningLabel : undefined}
        onPress={sheet.present}
        disabled={disabled || (!hasModels && !isLoading && !loadErrorMessage)}
        loading={isLoading && !hasModels}
        tone={loadErrorMessage ? "warning" : "default"}
        testID="model-picker"
        accessibilityLabel="Model and reasoning"
      />
      <Sheet
        controller={sheet}
        title="Model"
        layout="scroll"
        // A searchable sheet keeps a fixed height so the list does not jump
        // as matches come and go; short lists size to their content.
        snapPoints={showSearch ? [maxHeight] : undefined}
        maxDynamicContentSize={showSearch ? undefined : maxHeight}
        onDismiss={() => {
          setShowMore(false);
          setSearchQuery("");
        }}
      >
        {loadErrorMessage ? (
          <View className="mx-4 my-3 flex-row items-start gap-2 rounded-md border border-border bg-surface-attention px-3 py-2">
            <Icon name="AlertTriangle" size={16} color={tokens.warningText} />
            <Text variant="caption" tone="warning" className="flex-1">
              {loadErrorMessage}
            </Text>
          </View>
        ) : null}
        {isLoading && !hasModels ? (
          <View className="flex-row items-center gap-2 px-4 py-6">
            <Spinner />
            <Text variant="caption">Loading models…</Text>
          </View>
        ) : null}
        {!isLoading && !hasModels && !loadErrorMessage ? (
          <View className="px-4 py-6">
            <Text variant="caption" className="text-center">
              No models available for this provider.
            </Text>
          </View>
        ) : null}
        {showSearch ? (
          <View className="px-4 pb-2 pt-3">
            <SheetInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search models"
              autoCapitalize="none"
              returnKeyType="search"
              clearButtonMode="while-editing"
              testID="model-picker-search"
              accessibilityLabel="Search models"
            />
          </View>
        ) : null}
        {noMatches ? (
          <View className="px-4 py-6">
            <Text variant="caption" className="text-center">
              No models match your search
            </Text>
          </View>
        ) : null}
        {filtered.modelOptions.map((option) => (
          <ModelRow
            key={option.value}
            option={option}
            selected={option.value === modelValue}
            onSelect={onModelChange}
            testID={`model-picker-option-${option.value}`}
          />
        ))}
        {moreModelOptions.length > 0 && !filtered.isSearching ? (
          <ListRow
            title={showMore ? "Fewer models" : "More models"}
            subtitle={
              showMore
                ? undefined
                : `${moreModelOptions.length} retired or hidden`
            }
            leading={showMore ? "ChevronUp" : "ChevronDown"}
            onPress={() => setShowMore((current) => !current)}
            testID="model-picker-more"
          />
        ) : null}
        {visibleMoreOptions.map((option) => (
          <ModelRow
            key={option.value}
            option={option}
            selected={option.value === modelValue}
            onSelect={onModelChange}
            testID={`model-picker-option-${option.value}`}
          />
        ))}
        {showReasoning ? (
          <>
            <Separator />
            <View className="gap-2 px-4 py-3">
              <Text variant="sectionLabel">Reasoning</Text>
              <View className="flex-row flex-wrap gap-2">
                {reasoningOptions.map((option) => {
                  const active = option.value === reasoningValue;
                  return (
                    <Pressable
                      key={option.value}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => onReasoningChange(option.value)}
                      testID={`model-picker-reasoning-${option.value}`}
                      className={cn(
                        "h-9 flex-row items-center rounded-md border px-3",
                        active
                          ? "border-foreground bg-foreground"
                          : "border-border bg-transparent active:bg-state-hover",
                      )}
                    >
                      <Text
                        variant="label"
                        className={
                          active ? "text-background" : "text-foreground"
                        }
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </>
        ) : null}
        {fastMode ? (
          <>
            <Separator />
            <View className="flex-row items-center gap-3 px-4 py-3">
              <View className="flex-1">
                <Text variant="label">Fast mode</Text>
                <Text variant="caption">
                  Priority service tier for quicker responses.
                </Text>
              </View>
              <Switch
                checked={fastMode.enabled}
                onCheckedChange={fastMode.onChange}
                testID="model-picker-fast"
              />
            </View>
          </>
        ) : null}
      </Sheet>
    </>
  );
}

interface ModelRowProps {
  option: ModelPickerOption;
  selected: boolean;
  onSelect: (model: string) => void;
  testID: string;
}

function ModelRow({ option, selected, onSelect, testID }: ModelRowProps) {
  const { tokens } = useTheme();
  return (
    <ListRow
      title={option.label}
      subtitle={option.description || undefined}
      selected={selected}
      trailing={
        selected ? (
          <Icon name="Check" size={18} color={tokens.foreground} />
        ) : null
      }
      onPress={() => onSelect(option.value)}
      testID={testID}
    />
  );
}
