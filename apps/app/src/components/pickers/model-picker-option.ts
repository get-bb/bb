import type { PickerOption } from "./OptionPicker";

/** A model option can expose a distinct runtime route beside its friendly name. */
export interface ModelPickerOption extends PickerOption<string> {
  routeProviderId?: string;
}
