import { describe, expect, it } from "vitest";
import {
  WORK_TOGETHER_PRINCIPAL_ASSERTION_HEADER,
  WORK_TOGETHER_PRINCIPAL_CLAIM_KEYS,
  WORK_TOGETHER_PRINCIPAL_CLOCK_SKEW_SECONDS,
  WORK_TOGETHER_PRINCIPAL_JWT_ALG,
  WORK_TOGETHER_PRINCIPAL_JWT_TYP,
  WORK_TOGETHER_PRINCIPAL_MAX_LIFETIME_SECONDS,
} from "../src/work-together-principal-wire-profile.js";

describe("work-together principal wire profile", () => {
  it("exports the exact assertion header and JOSE header values", () => {
    expect(WORK_TOGETHER_PRINCIPAL_ASSERTION_HEADER).toBe(
      "x-work-together-principal",
    );
    expect(WORK_TOGETHER_PRINCIPAL_JWT_TYP).toBe("work-together-principal+jwt");
    expect(WORK_TOGETHER_PRINCIPAL_JWT_ALG).toBe("EdDSA");
  });

  it("exports the exact lifetime and clock-skew bounds", () => {
    expect(WORK_TOGETHER_PRINCIPAL_MAX_LIFETIME_SECONDS).toBe(60);
    expect(WORK_TOGETHER_PRINCIPAL_CLOCK_SKEW_SECONDS).toBe(5);
  });

  it("exports the exact required claim key list with no extras", () => {
    expect([...WORK_TOGETHER_PRINCIPAL_CLAIM_KEYS]).toEqual([
      "iss",
      "aud",
      "sub",
      "jti",
      "iat",
      "nbf",
      "exp",
      "workspace_id",
      "membership_revision",
      "principal_kind",
      "display_name",
      "request_method",
      "request_target",
      "transport",
    ]);
    expect(new Set(WORK_TOGETHER_PRINCIPAL_CLAIM_KEYS).size).toBe(
      WORK_TOGETHER_PRINCIPAL_CLAIM_KEYS.length,
    );
  });
});
