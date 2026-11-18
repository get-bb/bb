export interface ProfileClockReading {
  beforeMs: number;
  afterMs: number;
}

type OffsetBounds = { minimumOffsetMs: number; maximumOffsetMs: number };

type ProfileClockCalibration = OffsetBounds &
  (
    | { status: "calibrated"; offsetUs: number }
    | { status: "disjoint" | "uncertain"; offsetUs: null }
  );

export function calibrateProfileClock(args: {
  startClock: ProfileClockReading;
  endClock: ProfileClockReading;
  profileStartTimeUs: number;
  profileEndTimeUs: number;
  maximumUncertaintyMs: number;
}): ProfileClockCalibration {
  const minimumOffsetMs = Math.max(
    args.startClock.beforeMs - args.profileStartTimeUs / 1_000,
    args.endClock.beforeMs - args.profileEndTimeUs / 1_000,
  );
  const maximumOffsetMs = Math.min(
    args.startClock.afterMs - args.profileStartTimeUs / 1_000,
    args.endClock.afterMs - args.profileEndTimeUs / 1_000,
  );
  const bounds = { minimumOffsetMs, maximumOffsetMs };
  if (minimumOffsetMs > maximumOffsetMs)
    return { ...bounds, status: "disjoint", offsetUs: null };
  if (maximumOffsetMs - minimumOffsetMs > args.maximumUncertaintyMs)
    return { ...bounds, status: "uncertain", offsetUs: null };
  return {
    ...bounds,
    status: "calibrated",
    offsetUs: ((minimumOffsetMs + maximumOffsetMs) / 2) * 1_000,
  };
}
