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
