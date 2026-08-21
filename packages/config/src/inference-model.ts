export interface ProviderModelInfo {
  provider: string;
  modelId: string;
}

interface ParseProviderModelConfigArgs {
  name: string;
  value: string;
}

const PROVIDER_MODEL_PATTERN = /^([^/]+)\/([^/]+)$/u;

export function parseProviderModelConfig(
  args: ParseProviderModelConfigArgs,
): ProviderModelInfo {
  const match = PROVIDER_MODEL_PATTERN.exec(args.value);
  const provider = match?.[1];
  const modelId = match?.[2];
  if (provider && modelId) {
    return { provider, modelId };
  }
  throw new Error(
    `${args.name} must use provider/model format, received "${args.value}"`,
  );
}

function validateProviderModelConfig(
  args: ParseProviderModelConfigArgs,
): string {
  parseProviderModelConfig(args);
  return args.value;
}

export function validateInferenceModel(value: string): string {
  return validateProviderModelConfig({ name: "BB_INFERENCE", value });
}

export function validateInferenceFallbackModel(value: string): string {
  return validateProviderModelConfig({
    name: "BB_INFERENCE_FALLBACK",
    value,
  });
}

export function validateTranscriptionModel(value: string): string {
  return validateProviderModelConfig({ name: "BB_TRANSCRIPTION", value });
}
