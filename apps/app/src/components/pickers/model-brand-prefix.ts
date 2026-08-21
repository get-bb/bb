import type { PickerOption } from "./OptionPicker";

/**
 * A provider tab in the model picker: the generic picker option plus the
 * provider's declared copy the composer renders — `strings.brandPrefix`, so
 * the rows under it can drop the brand once provider context is unambiguous
 * (the trigger shows the provider icon; the menu shows provider tabs above
 * the model list; "Sonnet 4.6" / "5.5" reads cleaner than "Claude Sonnet
 * 4.6" / "GPT-5.5"), `strings.planModeCopy`, which marks a provider whose
 * plan mode changes the permission display, and `strings.installUrl`.
 */
export interface ProviderPickerOption extends PickerOption<string> {
  brandPrefix?: string;
  planModeCopy?: string;
  /** Where to install the provider's CLI, for the missing-executable hint. */
  installUrl?: string;
}

/**
 * Drops the provider's declared brand prefix from a model label. A provider
 * that declares none keeps its labels whole. Lives at the picker's render
 * site rather than in `formatModelLabel` so stories — which hand picker
 * labels in directly — see the same trigger and menu output as production
 * paths that go through the formatter.
 */
export function stripModelBrandPrefix(
  label: string,
  brandPrefix: string | undefined,
): string {
  if (brandPrefix === undefined || brandPrefix.length === 0) {
    return label;
  }
  return label.toLowerCase().startsWith(brandPrefix.toLowerCase())
    ? label.slice(brandPrefix.length).trimStart()
    : label;
}
