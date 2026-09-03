import type { PickerOption } from "./OptionPicker";

export interface ModelPickerOption extends PickerOption<string> {
  qualifier?: string;
  routeProviderId?: string;
}
