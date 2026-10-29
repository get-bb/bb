import { defineSplit } from "@/lib/define-split";

export const ThreadRowMetadataCollectors = defineSplit({
  id: "thread-row-metadata-collectors",
  load: () =>
    import("./ThreadRowMetadataCollectorsView").then(
      (module) => module.ThreadRowMetadataCollectorsView,
    ),
  loading: () => null,
  tier: "preload",
});
