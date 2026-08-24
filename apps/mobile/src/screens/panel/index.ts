export { usePanel } from "./PanelProvider";
export { ThreadWorkspacePanelProvider } from "./ThreadWorkspacePanelProvider";
export { ProjectWorkspacePanelProvider } from "./ProjectWorkspacePanelProvider";

// Registers the built-in contents (Info, placeholders) and the feature
// registrations. Last on purpose: feature `register.ts` modules may import
// this barrel, so the exports above must exist before they evaluate.
import "./contents";
