import type { CompareFaq } from "./compare-types";

export const FAQ_PLUGIN_TRUST: CompareFaq = {
  question: "What should I check before installing a plugin?",
  answer: (
    <p>
      Plugins are full-access code, like npm packages. Before you install one,
      read the code it installs, starting from the entry files in its manifest,
      plus its dependencies. Or ask an agent to explain what it does.
    </p>
  ),
};
