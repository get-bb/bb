import { afterAll, beforeAll } from "vitest";
import { setStoredEventDecodeCacheFreezeForTesting } from "../../src/services/threads/stored-event-decode-cache.js";

beforeAll(() => {
  setStoredEventDecodeCacheFreezeForTesting(true);
});

afterAll(() => {
  setStoredEventDecodeCacheFreezeForTesting(false);
});
