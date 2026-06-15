interface PopoutToggleSenderAuthorizationArgs {
  isApplicationWindowSender: boolean;
  isPopoutWindowSender: boolean;
}

export function shouldHandlePopoutToggleSender({
  isApplicationWindowSender,
  isPopoutWindowSender,
}: PopoutToggleSenderAuthorizationArgs): boolean {
  return isApplicationWindowSender || isPopoutWindowSender;
}

export function shouldHandlePopoutWindowSender(
  isPopoutWindowSender: boolean,
): boolean {
  return isPopoutWindowSender;
}
