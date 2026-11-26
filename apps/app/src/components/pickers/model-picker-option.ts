import type { PickerOption } from "@bb/shared-ui/option-picker";

export interface ModelPickerOption extends PickerOption<string> {
  routeProviderId?: string;
}
