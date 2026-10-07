import type { SupportedModelOptions } from "@bb/domain";
import type { PickerOption } from "./OptionPicker";

export interface ModelPickerOption extends PickerOption<string> {
  routeProviderId?: string;
  isDefault?: boolean;
  supportedModelOptions?: SupportedModelOptions;
}
