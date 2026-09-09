import { z } from "zod";

export const THREAD_ENV_VAR_NAME_MAX_CHARS = 128;
export const THREAD_ENV_VAR_VALUE_MAX_BYTES = 16 * 1024;
export const THREAD_ENV_VARS_MAX_BYTES = 64 * 1024;
export const THREAD_ENV_VARS_MAX_ENTRIES = 32;
export const THREAD_ENV_VAR_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

const encoder = new TextEncoder();

export const threadEnvVarNameSchema = z.string().superRefine((name, ctx) => {
  if (name.length === 0) {
    ctx.addIssue({ code: "custom", message: "must not be empty" });
  } else if (name.length > THREAD_ENV_VAR_NAME_MAX_CHARS) {
    ctx.addIssue({
      code: "custom",
      message: `must be at most ${THREAD_ENV_VAR_NAME_MAX_CHARS} characters`,
    });
  } else if (!THREAD_ENV_VAR_NAME_PATTERN.test(name)) {
    ctx.addIssue({
      code: "custom",
      message:
        "must start with a letter or underscore and contain only letters, numbers, and underscores",
    });
  } else if (name.startsWith("BB_")) {
    ctx.addIssue({
      code: "custom",
      message: "must not use the reserved BB_ prefix",
    });
  }
});

export const threadEnvVarValueSchema = z.string().superRefine((value, ctx) => {
  if (value.includes("\0")) {
    ctx.addIssue({ code: "custom", message: "must not contain a null byte" });
  }
  if (encoder.encode(value).byteLength > THREAD_ENV_VAR_VALUE_MAX_BYTES) {
    ctx.addIssue({
      code: "custom",
      message: `must be at most ${THREAD_ENV_VAR_VALUE_MAX_BYTES} UTF-8 bytes`,
    });
  }
});

export const threadEnvVarsSchema = z
  .record(threadEnvVarNameSchema, threadEnvVarValueSchema)
  .superRefine((envVars, ctx) => {
    if (Object.keys(envVars).length > THREAD_ENV_VARS_MAX_ENTRIES) {
      ctx.addIssue({
        code: "custom",
        message: `must contain at most ${THREAD_ENV_VARS_MAX_ENTRIES} entries`,
      });
    }
    if (
      encoder.encode(JSON.stringify(envVars)).byteLength >
      THREAD_ENV_VARS_MAX_BYTES
    ) {
      ctx.addIssue({
        code: "custom",
        message: `must be at most ${THREAD_ENV_VARS_MAX_BYTES} UTF-8 bytes when serialized`,
      });
    }
  });

export type ThreadEnvVars = z.infer<typeof threadEnvVarsSchema>;
