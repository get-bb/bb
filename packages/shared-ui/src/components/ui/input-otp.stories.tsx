import { useState } from "react";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "./input-otp.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/InputOTP",
};

function SixDigitCodeDemo() {
  const [value, setValue] = useState("42");
  return (
    <InputOTP maxLength={6} value={value} onChange={setValue}>
      <InputOTPGroup>
        <InputOTPSlot index={0} />
        <InputOTPSlot index={1} />
        <InputOTPSlot index={2} />
      </InputOTPGroup>
      <InputOTPSeparator />
      <InputOTPGroup>
        <InputOTPSlot index={3} />
        <InputOTPSlot index={4} />
        <InputOTPSlot index={5} />
      </InputOTPGroup>
    </InputOTP>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="6-digit code, grouped 3+3">
        <SixDigitCodeDemo />
      </StoryRow>
    </StoryCard>
  );
}
