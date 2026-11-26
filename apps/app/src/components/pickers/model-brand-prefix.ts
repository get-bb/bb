import type { PickerOption } from "@bb/shared-ui/option-picker";

export interface ProviderPickerOption extends PickerOption<string> {
  brandPrefix?: string;
  planModeCopy?: string;
  installUrl?: string;
}

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
