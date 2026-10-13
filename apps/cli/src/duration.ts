const DURATION_UNIT_MS = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
} as const;

export type DurationUnit = keyof typeof DURATION_UNIT_MS;

const DURATION_PATTERN = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/;

const DEFAULT_UNIT_LABEL: Record<DurationUnit, string> = {
  ms: "milliseconds",
  s: "seconds",
  m: "minutes",
  h: "hours",
  d: "days",
};

export interface ParsedDuration {
  amount: number;
  unit: DurationUnit | null;
}

export function matchDuration(value: string): ParsedDuration | null {
  const match = DURATION_PATTERN.exec(value.trim().toLowerCase());
  if (!match) return null;
  const unit = match[2];
  return {
    amount: Number.parseFloat(match[1]),
    unit: isDurationUnit(unit) ? unit : null,
  };
}

function isDurationUnit(value: string | undefined): value is DurationUnit {
  return value !== undefined && value in DURATION_UNIT_MS;
}

export function durationUnitMs(unit: DurationUnit): number {
  return DURATION_UNIT_MS[unit];
}

export interface ParseDurationMsArgs {
  allowZero: boolean;
  defaultUnit: DurationUnit;
  label: string;
  value: string;
}

export function durationHelp(defaultUnit: DurationUnit): string {
  return `a number of ${DEFAULT_UNIT_LABEL[defaultUnit]} or a duration with a unit (500ms, 90s, 5m, 2h)`;
}

export function parseDurationMs(args: ParseDurationMsArgs): number {
  const parsed = matchDuration(args.value);
  if (parsed === null) {
    throw new Error(
      `Invalid ${args.label} value '${args.value}'. Expected ${durationHelp(args.defaultUnit)}.`,
    );
  }
  const milliseconds = Math.round(
    parsed.amount * DURATION_UNIT_MS[parsed.unit ?? args.defaultUnit],
  );
  if (milliseconds === 0 && !args.allowZero) {
    throw new Error(`${args.label} must be greater than zero.`);
  }
  return milliseconds;
}
