import type { PluginProviderFallbackModel } from "@get-bb/plugin-sdk";

export const BENCH_STREAM_PROVIDER_ID = "bench-stream";

export const BENCH_STREAM_MODEL_ID = "bench-stream-model";

export const BENCH_STREAM_MODEL = {
  id: BENCH_STREAM_MODEL_ID,
  displayName: "Bench stream model",
  description:
    "Streams scripted Markdown at a controlled rate for the thread streaming benchmark.",
  supportedReasoningEfforts: [
    { reasoningEffort: "medium", description: "Medium" },
  ],
  defaultReasoningEffort: "medium",
  isDefault: true,
} satisfies PluginProviderFallbackModel;

export const BENCH_STREAM_LOG_DIR_ENV = "BENCH_STREAM_LOG_DIR";
