import { useId } from "react";
import { Button } from "@bb/shared-ui/button";
import { Checkbox } from "@bb/shared-ui/checkbox";
import { Input } from "@bb/shared-ui/input";
import { Label } from "@bb/shared-ui/label";
import { RadioGroup, RadioGroupItem } from "@bb/shared-ui/radio-group";
import type { CodexMcpFormField } from "./mcp-elicitation.js";

export type CodexMcpFormDraftValue = string | boolean | string[];

export function CodexMcpElicitationField({
  field,
  value,
  error,
  disabled,
  onChange,
}: {
  field: CodexMcpFormField;
  value: CodexMcpFormDraftValue | undefined;
  error: string | undefined;
  disabled: boolean;
  onChange(value: CodexMcpFormDraftValue | undefined): void;
}) {
  const id = useId();
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const describedBy =
    [field.description !== null ? descriptionId : null, error ? errorId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex items-center gap-2">
        <Label
          id={`${id}-label`}
          htmlFor={id}
          className="text-sm font-semibold"
        >
          {field.title}
        </Label>
        {!field.required ? (
          <span className="text-xs text-muted-foreground">Optional</span>
        ) : null}
        {!field.required && value !== undefined ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto h-6 px-2"
            disabled={disabled}
            aria-label={`Clear ${field.title}`}
            onClick={() => onChange(undefined)}
          >
            Clear
          </Button>
        ) : null}
      </div>
      {field.description !== null ? (
        <p id={descriptionId} className="text-xs text-muted-foreground">
          {field.description}
        </p>
      ) : null}
      {field.kind === "boolean" ? (
        <RadioGroup
          id={id}
          aria-labelledby={`${id}-label`}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
          value={typeof value === "boolean" ? String(value) : ""}
          disabled={disabled}
          onValueChange={(choice) => onChange(choice === "true")}
          className="gap-0.5"
        >
          {[true, false].map((choice) => (
            <div
              key={String(choice)}
              className={`flex min-h-8 items-center gap-2.5 rounded-md px-2.5 py-1.5 ${value === choice ? "bg-surface-selected" : "hover:bg-state-hover"}`}
            >
              <RadioGroupItem value={String(choice)} id={`${id}-${choice}`} />
              <Label
                htmlFor={`${id}-${choice}`}
                className="flex-1 cursor-pointer text-sm font-medium"
              >
                {choice ? "Yes" : "No"}
              </Label>
            </div>
          ))}
        </RadioGroup>
      ) : field.kind === "enum" ? (
        <RadioGroup
          id={id}
          aria-labelledby={`${id}-label`}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
          value={
            value === undefined
              ? ""
              : String(
                  field.options.findIndex((option) => option.value === value),
                )
          }
          disabled={disabled}
          className="gap-0.5"
          onValueChange={(index) => {
            const option = field.options[Number(index)];
            if (option) onChange(option.value);
          }}
        >
          {field.options.map((option, index) => (
            <div
              key={option.value}
              className={`flex min-h-8 items-center gap-2.5 rounded-md px-2.5 py-1.5 ${value === option.value ? "bg-surface-selected" : "hover:bg-state-hover"}`}
            >
              <RadioGroupItem value={String(index)} id={`${id}-${index}`} />
              <Label
                htmlFor={`${id}-${index}`}
                className="flex-1 cursor-pointer text-sm font-medium"
              >
                {option.label}
              </Label>
            </div>
          ))}
        </RadioGroup>
      ) : field.kind === "multi_enum" ? (
        <div
          id={id}
          role="group"
          aria-labelledby={`${id}-label`}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
          className="space-y-0.5"
        >
          {field.options.map((option, index) => {
            const selected = Array.isArray(value) ? value : [];
            return (
              <div
                key={option.value}
                className={`flex min-h-8 items-center gap-2.5 rounded-md px-2.5 py-1.5 ${selected.includes(option.value) ? "bg-surface-selected" : "hover:bg-state-hover"}`}
              >
                <Checkbox
                  id={`${id}-${index}`}
                  checked={selected.includes(option.value)}
                  disabled={disabled}
                  onCheckedChange={(checked) =>
                    onChange(
                      checked === true
                        ? [...selected, option.value]
                        : selected.filter((entry) => entry !== option.value),
                    )
                  }
                />
                <Label
                  htmlFor={`${id}-${index}`}
                  className="flex-1 cursor-pointer text-sm font-medium"
                >
                  {option.label}
                </Label>
              </div>
            );
          })}
        </div>
      ) : (
        <Input
          id={id}
          value={typeof value === "string" ? value : ""}
          type={
            field.kind === "string" && field.format === "email"
              ? "email"
              : field.kind === "string" && field.format === "date"
                ? "date"
                : "text"
          }
          inputMode={
            field.kind === "integer"
              ? "numeric"
              : field.kind === "number"
                ? "decimal"
                : field.kind === "string" && field.format === "uri"
                  ? "url"
                  : undefined
          }
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-destructive-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
