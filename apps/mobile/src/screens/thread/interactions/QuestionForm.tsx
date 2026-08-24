import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import {
  answerStateFor,
  areAllQuestionsAnswered,
  createInitialFormState,
  isQuestionAnswered,
  setQuestionFreeText,
  toggleQuestionOption,
  toggleQuestionOther,
  type InteractionFormQuestion,
  type QuestionAnswerState,
  type QuestionFormState,
} from "@/data/interactions";
import { useTheme } from "@/theme";
import { Button, cn, Icon, Text, TextArea } from "@/ui";

const OTHER_OPTION_LABEL = "Other…";
const PREVIEW_MAX_HEIGHT = 220;

interface QuestionFormProps {
  /** Resets the form when a different interaction takes over. */
  interactionId: string;
  questions: readonly InteractionFormQuestion[];
  /** Everything disabled while a submit / server `resolving` is in flight. */
  disabled: boolean;
  submitting: boolean;
  onSubmit: (formState: QuestionFormState) => void;
  onCancel: () => void;
}

interface QuestionOptionRowProps {
  checked: boolean;
  label: string;
  description?: string;
  multiSelect: boolean;
  disabled: boolean;
  onSelect: () => void;
  testID?: string;
}

function QuestionOptionRow({
  checked,
  label,
  description,
  multiSelect,
  disabled,
  onSelect,
  testID,
}: QuestionOptionRowProps) {
  const { tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole={multiSelect ? "checkbox" : "radio"}
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onSelect}
      className={cn(
        "min-h-11 flex-row items-start gap-2.5 rounded-md px-2.5 py-2 active:bg-state-hover",
        checked && "bg-surface-selected",
      )}
      testID={testID}
    >
      <View
        className={cn(
          "mt-0.5 h-4 w-4 items-center justify-center border",
          multiSelect ? "rounded" : "rounded-full",
          checked ? "border-primary bg-primary" : "border-input",
        )}
      >
        {checked ? (
          <Icon name="Check" size={12} color={tokens.primaryForeground} />
        ) : null}
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-sm font-medium">{label}</Text>
        {description ? (
          <Text variant="caption" className="mt-0.5">
            {description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * Claude's intent for `preview` is "rendered when the option is focused";
 * selection is the touch stand-in. Preformatted mono, capped and scrollable.
 */
function QuestionOptionPreview({ preview }: { preview: string }) {
  return (
    <ScrollView
      className="mx-2.5 mb-1 mt-1 rounded-md border border-border bg-surface-raised"
      style={{ maxHeight: PREVIEW_MAX_HEIGHT }}
      nestedScrollEnabled
    >
      <Text variant="mono" className="px-2.5 py-2 text-xs" selectable>
        {preview}
      </Text>
    </ScrollView>
  );
}

function QuestionTabs({
  currentIndex,
  formState,
  onSelect,
  questions,
}: {
  currentIndex: number;
  formState: QuestionFormState;
  onSelect: (index: number) => void;
  questions: readonly InteractionFormQuestion[];
}) {
  return (
    <View className="mb-2 flex-row items-center gap-2">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="min-w-0 flex-1"
        contentContainerStyle={{ gap: 4, alignItems: "center" }}
      >
        {questions.map((question, index) => {
          const answered = isQuestionAnswered(
            question,
            answerStateFor(formState, question),
          );
          const isActive = index === currentIndex;
          return (
            <Pressable
              key={question.id}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={question.prompt}
              onPress={() => onSelect(index)}
              className={cn(
                "h-7 justify-center rounded-md px-2 active:bg-state-hover",
                isActive && "bg-muted",
              )}
              testID={`question-tab-${index}`}
            >
              <Text
                className={cn(
                  "text-xs",
                  isActive ? "text-foreground" : "text-muted-foreground",
                  answered && "line-through",
                )}
                numberOfLines={1}
                style={{ maxWidth: 180 }}
              >
                {question.shortLabel}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <Text variant="caption">
        {currentIndex + 1} of {questions.length}
      </Text>
    </View>
  );
}

function QuestionInputBlock({
  disabled,
  question,
  state,
  onToggleOption,
  onSelectOther,
  onFreeTextChange,
}: {
  disabled: boolean;
  question: InteractionFormQuestion;
  state: QuestionAnswerState;
  onToggleOption: (optionValue: string) => void;
  onSelectOther: () => void;
  onFreeTextChange: (value: string) => void;
}) {
  const options = question.options;
  return (
    <View className="min-w-0">
      <Text className="text-sm font-semibold" testID="question-prompt">
        {question.prompt}
      </Text>
      <View className="mt-2 gap-0.5">
        {options.map((option, index) => {
          const checked = state.selected.includes(option.value);
          return (
            <View key={option.value}>
              <QuestionOptionRow
                checked={checked}
                label={option.label}
                description={option.description}
                multiSelect={question.multiSelect}
                disabled={disabled}
                onSelect={() => onToggleOption(option.value)}
                testID={`question-option-${index}`}
              />
              {checked && option.preview ? (
                <QuestionOptionPreview preview={option.preview} />
              ) : null}
            </View>
          );
        })}
        {question.allowFreeText && options.length > 0 ? (
          <QuestionOptionRow
            checked={state.otherSelected}
            label={OTHER_OPTION_LABEL}
            multiSelect={question.multiSelect}
            disabled={disabled}
            onSelect={onSelectOther}
            testID="question-option-other"
          />
        ) : null}
      </View>
      {state.otherSelected ? (
        <TextArea
          accessibilityLabel={`${question.shortLabel} answer`}
          value={state.otherText}
          editable={!disabled}
          autoCapitalize="sentences"
          onChangeText={onFreeTextChange}
          placeholder="Type your own answer…"
          className="mt-2 max-h-40 bg-surface-raised"
          testID="question-free-text"
        />
      ) : null}
    </View>
  );
}

/**
 * One question at a time with a tab strip for several (ports the web
 * UserQuestionAnswerForm / the ask-user-question plugin form). Form state
 * resets only when `interactionId` changes, never on a background refetch
 * of the same interaction.
 */
export function QuestionForm({
  interactionId,
  questions,
  disabled,
  submitting,
  onSubmit,
  onCancel,
}: QuestionFormProps) {
  const [formState, setFormState] = useState<QuestionFormState>(() =>
    createInitialFormState(questions),
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeInteractionId, setActiveInteractionId] = useState(interactionId);
  if (activeInteractionId !== interactionId) {
    setActiveInteractionId(interactionId);
    setFormState(createInitialFormState(questions));
    setCurrentIndex(0);
  }

  const totalQuestions = questions.length;
  const currentQuestion = questions[currentIndex] ?? null;
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === totalQuestions - 1;
  const allAnswered = useMemo(
    () => areAllQuestionsAnswered(questions, formState),
    [formState, questions],
  );

  const updateQuestionState = (
    question: InteractionFormQuestion,
    update: (state: QuestionAnswerState) => QuestionAnswerState,
  ): void => {
    setFormState((current) => ({
      ...current,
      [question.id]: update(answerStateFor(current, question)),
    }));
  };

  const handleAdvance = (): void => {
    if (isLast) {
      if (disabled || !allAnswered) return;
      onSubmit(formState);
      return;
    }
    setCurrentIndex((index) => Math.min(index + 1, totalQuestions - 1));
  };

  if (!currentQuestion) return null;
  const currentState = answerStateFor(formState, currentQuestion);

  return (
    <View>
      {totalQuestions > 1 ? (
        <QuestionTabs
          currentIndex={currentIndex}
          formState={formState}
          onSelect={setCurrentIndex}
          questions={questions}
        />
      ) : null}
      <QuestionInputBlock
        disabled={disabled}
        question={currentQuestion}
        state={currentState}
        onToggleOption={(optionValue) =>
          updateQuestionState(currentQuestion, (state) =>
            toggleQuestionOption(currentQuestion, state, optionValue),
          )
        }
        onSelectOther={() =>
          updateQuestionState(currentQuestion, (state) =>
            toggleQuestionOther(currentQuestion, state),
          )
        }
        onFreeTextChange={(value) =>
          updateQuestionState(currentQuestion, (state) =>
            setQuestionFreeText(state, value),
          )
        }
      />
      <View className="mt-3 flex-row items-center justify-between gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          onPress={onCancel}
          testID="question-cancel"
        >
          Cancel
        </Button>
        <View className="flex-row items-center gap-2">
          {!isFirst ? (
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onPress={() => setCurrentIndex((index) => Math.max(index - 1, 0))}
              testID="question-back"
            >
              Back
            </Button>
          ) : null}
          <Button
            size="sm"
            disabled={disabled || (isLast && !allAnswered)}
            loading={submitting && isLast}
            haptic={isLast ? "medium" : "selection"}
            onPress={handleAdvance}
            testID={isLast ? "question-submit" : "question-next"}
          >
            {isLast ? "Submit answer" : "Next"}
          </Button>
        </View>
      </View>
    </View>
  );
}
