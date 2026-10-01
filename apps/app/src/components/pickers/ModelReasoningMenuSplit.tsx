import { defineSplit } from "@/lib/define-split";
import { PickerLoadingRows } from "./PickerLoadingRows";

export const ModelReasoningMenu = defineSplit({
  id: "model-reasoning-menu",
  load: () =>
    import("./ModelReasoningMenu").then((module) => module.ModelReasoningMenu),
  loading: () => (
    <div className="px-1 pt-2">
      <PickerLoadingRows
        label="Loading model picker"
        rowDataAttribute="data-model-menu-loading-row"
      />
    </div>
  ),
  preload: "startup",
});
