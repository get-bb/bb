export function uninstallCommand(hostId: string): string[] {
  return [
    "sh",
    "-c",
    [
      'if [ ! -e "$HOME/.local/bin/bb" ] && [ ! -L "$HOME/.local/bin/bb" ]; then exit 0; fi',
      'exec "$HOME/.local/bin/bb" machine uninstall --host-id "$1"',
    ].join("\n"),
    "bb",
    hostId,
  ];
}
