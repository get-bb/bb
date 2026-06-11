import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_ENDPOINT,
  isClaudeCodeMockCliTrafficEndpoint,
} from "../src/index.js";

interface EndpointCase {
  endpoint: string;
  expected: boolean;
}

const endpointCases = [
  { endpoint: "http://127.0.0.1:18950", expected: true },
  { endpoint: "http://localhost:18950", expected: true },
  { endpoint: "http://[::1]:18950", expected: true },
  { endpoint: "https://api.anthropic.com", expected: true },
  { endpoint: "https://api.anthropic.com:443", expected: true },
  { endpoint: "https://127.0.0.1:18950", expected: false },
  { endpoint: "http://test.anthropic.com", expected: false },
  { endpoint: "https://api.anthropic.com.evil.test", expected: false },
] satisfies EndpointCase[];

describe("Claude Code mock CLI traffic endpoint validation", () => {
  it("defaults to the approved Anthropic test endpoint", () => {
    expect(DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_ENDPOINT).toBe(
      "https://api.anthropic.com",
    );
  });

  it.each(endpointCases)("$endpoint -> $expected", (testCase) => {
    expect(isClaudeCodeMockCliTrafficEndpoint(testCase.endpoint)).toBe(
      testCase.expected,
    );
  });
});
