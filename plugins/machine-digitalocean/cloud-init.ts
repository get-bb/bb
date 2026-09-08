function quote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function cloudInit(installer: {
  command: string[];
  stdin: string;
}): string {
  const path = "/run/bb-enrollment.stdin";
  const data =
    "#cloud-config\n" +
    JSON.stringify({
      package_update: true,
      packages: [
        "ca-certificates",
        "curl",
        "xz-utils",
        "git",
        "build-essential",
      ],
      write_files: [
        {
          path,
          owner: "root:root",
          permissions: "0600",
          encoding: "b64",
          content: Buffer.from(installer.stdin).toString("base64"),
        },
      ],
      runcmd: [
        [
          "sh",
          "-c",
          [
            "set -eu",
            "umask 077",
            `trap 'rm -f ${path} /run/bb-node.tar.xz' EXIT`,
            "curl -fsSL --connect-timeout 10 --max-time 180 --retry 2 https://nodejs.org/dist/v22.23.2/node-v22.23.2-linux-x64.tar.xz -o /run/bb-node.tar.xz",
            "echo 'd60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307  /run/bb-node.tar.xz' | sha256sum -c -",
            "tar -xJf /run/bb-node.tar.xz -C /usr/local --strip-components=1",
            "rm -f /run/bb-node.tar.xz",
            'export PATH="/usr/local/bin:$PATH"',
            "node --version",
            "npm --version",
            `${installer.command.map(quote).join(" ")} < ${path} >/dev/null 2>&1`,
          ].join("\n"),
        ],
      ],
    });
  if (Buffer.byteLength(data) > 64 * 1024)
    throw new Error(
      "DigitalOcean cloud-init exceeds the 64 KiB user-data limit.",
    );
  return data;
}
