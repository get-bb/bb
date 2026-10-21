import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { publicationHostContract } from "./src/publication-contract.js";
import { inspectPublication, publishPublication } from "./src/publication.js";

export default experimental_defineHostEntry({
  contract: publicationHostContract,
  handlers: {
    inspectPublication(input, context) {
      return inspectPublication(input, {
        tempDir: context.experimental_paths.tempDir,
        signal: context.signal,
      });
    },
    publish(input, context) {
      return publishPublication(input, {
        tempDir: context.experimental_paths.tempDir,
        signal: context.signal,
      });
    },
  },
});
