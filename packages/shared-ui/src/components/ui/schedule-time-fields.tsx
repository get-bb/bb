import { useId } from "react";

import {
  CUSTOM_SCHEDULE_OPTION_ID,
  MAX_SCHEDULE_AHEAD_MS,
  formatDateInputValue,
  formatScheduleTime,
  formatScheduleTimeZone,
  isScheduleOptionId,
  listSchedulePresets,
  resolveScheduleOption,
  type CustomScheduleFields,
  type ScheduleOptionId,
} from "../../lib/schedule-time";
import { Input } from "./input.js";
import { Label } from "./label.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select.js";

interface ScheduleTimeFieldsProps {
  optionId: ScheduleOptionId;
  custom: CustomScheduleFields;
  now: number;
  disabled: boolean;
  error: string | null;
  onOptionChange: (optionId: ScheduleOptionId) => void;
  onCustomChange: (custom: CustomScheduleFields) => void;
}

export function ScheduleTimeFields({
  optionId,
  custom,
  now,
  disabled,
  error,
  onOptionChange,
  onCustomChange,
}: ScheduleTimeFieldsProps) {
  const whenId = useId();
  const customDateId = useId();
  const customTimeId = useId();
  const presets = listSchedulePresets(now);
  const preview = resolveScheduleOption(optionId, custom, now);
  const visibleError = error ?? (preview.ok ? null : preview.message);

  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor={whenId}>When</Label>
        <Select
          disabled={disabled}
          onValueChange={(value) => {
            if (isScheduleOptionId(value)) onOptionChange(value);
          }}
          value={optionId}
        >
          <SelectTrigger aria-label="When to send" id={whenId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {presets.map((preset) => (
              <SelectItem key={preset.id} value={preset.id}>
                {preset.label}
              </SelectItem>
            ))}
            <SelectItem value={CUSTOM_SCHEDULE_OPTION_ID}>
              Custom date and time
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {optionId === CUSTOM_SCHEDULE_OPTION_ID ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor={customDateId}>Date</Label>
            <Input
              disabled={disabled}
              id={customDateId}
              max={formatDateInputValue(now + MAX_SCHEDULE_AHEAD_MS)}
              min={formatDateInputValue(now)}
              onChange={(event) =>
                onCustomChange({ ...custom, date: event.target.value })
              }
              type="date"
              value={custom.date}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={customTimeId}>Time</Label>
            <Input
              disabled={disabled}
              id={customTimeId}
              onChange={(event) =>
                onCustomChange({ ...custom, time: event.target.value })
              }
              type="time"
              value={custom.time}
            />
          </div>
        </div>
      ) : null}

      {preview.ok ? (
        <div aria-live="polite" className="rounded-md bg-muted/50 px-3 py-2">
          <p className="font-medium">
            Sends {formatScheduleTime(preview.at, now)}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatScheduleTimeZone(preview.at)}
          </p>
        </div>
      ) : null}

      {visibleError === null ? null : (
        <p className="text-destructive" role="alert">
          {visibleError}
        </p>
      )}
    </>
  );
}
