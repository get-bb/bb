import { installPluginRuntime } from "../src/lib/plugin-frontend";
import {
  useStoryComposerCommandSearch,
  useStoryComposerMentionSearch,
} from "./composer-search-story";

const runtime = installPluginRuntime();
runtime.pluginSdkApp = {
  ...runtime.pluginSdkApp,
  experimental_useComposerMentionSearch: useStoryComposerMentionSearch,
  experimental_useComposerCommandSearch: useStoryComposerCommandSearch,
};
