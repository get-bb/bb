export interface DiffCumulativeTextArgs {
  nextText: string;
  previousText?: string;
}

export interface DiffCumulativeTextResult {
  delta: string;
  nextText: string;
  reset: boolean;
}

/**
 * Diffs a cumulative text snapshot against the previous one: emits only the
 * appended suffix when the provider keeps appending, or the full text with
 * `reset: true` when the snapshot restarted.
 */
export function diffCumulativeText(
  args: DiffCumulativeTextArgs,
): DiffCumulativeTextResult | null {
  const previousText = args.previousText ?? "";
  if (args.nextText.length === 0 || args.nextText === previousText) {
    return null;
  }
  if (previousText.length === 0) {
    return {
      delta: args.nextText,
      nextText: args.nextText,
      reset: false,
    };
  }
  if (args.nextText.startsWith(previousText)) {
    const delta = args.nextText.slice(previousText.length);
    return delta.length > 0
      ? {
          delta,
          nextText: args.nextText,
          reset: false,
        }
      : null;
  }
  return {
    delta: args.nextText,
    nextText: args.nextText,
    reset: true,
  };
}
