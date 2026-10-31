import { useCallback, useEffect, useRef, useState } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { LoginView } from "../src/schemas.js";

export interface AccountLoginTransport {
  start(): Promise<LoginView>;
  poll(loginId: string): Promise<LoginView | null>;
  cancel(loginId: string): Promise<void>;
}

export const ACCOUNT_LOGIN_POLL_MS = 2_000;
const ACCOUNT_LOGIN_POLL_MAX_MS = 30_000;

function loginPollDelay(failures: number): number {
  return failures === 0
    ? ACCOUNT_LOGIN_POLL_MS
    : Math.min(
        ACCOUNT_LOGIN_POLL_MS * 2 ** failures,
        ACCOUNT_LOGIN_POLL_MAX_MS,
      );
}

export interface AccountLogin {
  login: LoginView | null;
  starting: boolean;
  error: string | null;
  start(): void;
  cancel(): void;
}

export function useAccountLogin({
  transport,
  describeStartError,
  onSignedIn,
  observedLogin,
}: {
  transport: AccountLoginTransport;
  describeStartError: (error: unknown) => string;
  onSignedIn: () => void;
  observedLogin: LoginView | null;
}): AccountLogin {
  const navigate = useBbNavigate();
  const [ownLogin, setOwnLogin] = useState<LoginView | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onSignedInRef = useRef(onSignedIn);
  useEffect(() => {
    onSignedInRef.current = onSignedIn;
  });

  const login =
    ownLogin !== null && observedLogin?.id === ownLogin.id
      ? observedLogin
      : ownLogin;

  const start = useCallback(() => {
    setStarting(true);
    setError(null);
    transport.start().then(
      (view) => {
        setStarting(false);
        setOwnLogin(view);
        if (view.state === "pending") navigate.openUrl(view.verificationUrl);
      },
      (startError: unknown) => {
        setStarting(false);
        setError(describeStartError(startError));
      },
    );
  }, [describeStartError, navigate, transport]);

  const pendingId = login?.state === "pending" ? login.id : null;
  useEffect(() => {
    if (pendingId === null) return;
    let cancelled = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = () => {
      transport
        .poll(pendingId)
        .then(
          (next) => {
            failures = 0;
            if (!cancelled && next !== null && next.id === pendingId) {
              setOwnLogin(next);
            }
          },
          () => {
            failures += 1;
          },
        )
        .finally(() => {
          if (!cancelled) timer = setTimeout(poll, loginPollDelay(failures));
        });
    };
    timer = setTimeout(poll, ACCOUNT_LOGIN_POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pendingId, transport]);

  const signedInId = login?.state === "signed-in" ? login.id : null;
  useEffect(() => {
    if (signedInId !== null) onSignedInRef.current();
  }, [signedInId]);

  const cancel = useCallback(() => {
    if (pendingId !== null) {
      transport.cancel(pendingId).then(
        () => {},
        () => {},
      );
    }
    setOwnLogin(null);
    setError(null);
  }, [pendingId, transport]);

  return { login, starting, error, start, cancel };
}
