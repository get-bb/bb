import type { SecretRequestPayload } from "@bb/plugin-interaction-contracts";
import { useState } from "react";
import { Pressable, View } from "react-native";
import {
  buildSecretRequestResponse,
  type SecretRequestFormResult,
} from "@/data/interactions";
import { useTheme } from "@/theme";
import { Button, Icon, Input, Text } from "@/ui";

interface SecretRequestFormProps {
  /** Resets the fields when a different interaction takes over. */
  interactionId: string;
  payload: SecretRequestPayload;
  disabled: boolean;
  submitting: boolean;
  onSubmit: (result: Extract<SecretRequestFormResult, { ok: true }>) => void;
  onCancel: () => void;
}

/**
 * Native form for the `secrets` plugin's `secret-request` interaction (ports
 * plugins/secrets/app.tsx): one secure field per requested variable with a
 * reveal toggle, validated against the plugin's response contract before
 * `POST …/respond`. Values never leave component state except in the submit.
 */
export function SecretRequestForm({
  interactionId,
  payload,
  disabled,
  submitting,
  onSubmit,
  onCancel,
}: SecretRequestFormProps) {
  const { tokens } = useTheme();
  const [values, setValues] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [activeInteractionId, setActiveInteractionId] = useState(interactionId);
  if (activeInteractionId !== interactionId) {
    setActiveInteractionId(interactionId);
    setValues({});
    setRevealed({});
    setFormError(null);
  }

  const submit = (): void => {
    const result = buildSecretRequestResponse(payload, values);
    if (!result.ok) {
      setFormError(result.message);
      return;
    }
    setFormError(null);
    onSubmit(result);
  };

  return (
    <View className="gap-4">
      <View className="gap-2">
        {payload.purpose ? (
          <Text className="text-sm">{payload.purpose}</Text>
        ) : null}
        <Text variant="caption">
          Secrets will be written directly to{" "}
          <Text variant="mono" className="text-xs">
            {payload.destination.path}
          </Text>
        </Text>
      </View>
      <View className="gap-3.5">
        {payload.fields.map((field) => {
          const isRevealed = revealed[field.name] ?? false;
          return (
            <View key={field.name} className="min-w-0 gap-1.5">
              <View className="gap-0.5">
                <Text variant="mono" className="text-xs font-semibold">
                  {field.name}
                </Text>
                {field.description ? (
                  <Text variant="caption">{field.description}</Text>
                ) : null}
              </View>
              <View className="flex-row items-center">
                <Input
                  mono
                  secureTextEntry={!isRevealed}
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  textContentType="password"
                  editable={!disabled}
                  value={values[field.name] ?? ""}
                  onChangeText={(text) =>
                    setValues((current) => ({ ...current, [field.name]: text }))
                  }
                  accessibilityLabel={field.name}
                  className="flex-1 bg-card pr-11"
                  testID={`secret-field-${field.name}`}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${isRevealed ? "Hide" : "Show"} ${field.name}`}
                  accessibilityState={{ selected: isRevealed }}
                  disabled={disabled}
                  onPress={() =>
                    setRevealed((current) => ({
                      ...current,
                      [field.name]: !current[field.name],
                    }))
                  }
                  className="absolute right-1 h-8 w-8 items-center justify-center rounded-md active:bg-state-hover"
                  hitSlop={6}
                >
                  <Icon
                    name={isRevealed ? "EyeOff" : "Eye"}
                    size={16}
                    color={tokens.mutedForeground}
                  />
                </Pressable>
              </View>
            </View>
          );
        })}
      </View>
      {formError ? (
        <View
          className="rounded-md border border-surface-destructive-border bg-surface-destructive px-2 py-1"
          accessibilityRole="alert"
        >
          <Text className="text-xs text-destructive-text">{formError}</Text>
        </View>
      ) : null}
      <View className="flex-row items-center justify-end gap-2 border-t border-border/70 pt-3">
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          onPress={onCancel}
          testID="secret-cancel"
        >
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={disabled}
          loading={submitting}
          haptic="medium"
          onPress={submit}
          testID="secret-submit"
        >
          Add secrets
        </Button>
      </View>
    </View>
  );
}
