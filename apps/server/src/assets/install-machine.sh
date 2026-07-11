#!/bin/sh

set -eu

usage() {
  cat >&2 <<'EOF'
Usage: install.sh --join-code <code> --host-id <host-id> --server <url> [--machine-code <code>]

The first three options are required. --machine-code is required through bb connect.
EOF
  exit 2
}

join_code=
host_id=
server_url=
machine_code=

while [ "$#" -gt 0 ]; do
  case "$1" in
    --join-code|--host-id|--server|--machine-code)
      [ "$#" -ge 2 ] || usage
      [ -n "$2" ] || usage
      case "$1" in
        --join-code) join_code=$2 ;;
        --host-id) host_id=$2 ;;
        --server) server_url=$2 ;;
        --machine-code) machine_code=$2 ;;
      esac
      shift 2
      ;;
    -h|--help) usage ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      ;;
  esac
done

[ -n "$join_code" ] || usage
[ -n "$host_id" ] || usage
[ -n "$server_url" ] || usage

case "$(uname -s)" in
  Darwin) platform=darwin ;;
  Linux) platform=linux ;;
  *)
    echo "bb machine installation supports macOS and Linux only." >&2
    exit 1
    ;;
esac

bb_app=
installed_version=
server_version=
if command -v bb-app >/dev/null 2>&1; then
  bb_app=$(command -v bb-app)
  if command -v node >/dev/null 2>&1; then
    installed_version=$(node -e '
      const fs = require("node:fs");
      const path = require("node:path");
      let current = path.dirname(fs.realpathSync(process.argv[1]));
      while (current !== path.dirname(current)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(path.join(current, "package.json"), "utf8"));
          if (pkg.name === "bb-app" && typeof pkg.version === "string") {
            process.stdout.write(pkg.version);
            process.exit(0);
          }
        } catch {}
        current = path.dirname(current);
      }
      process.exit(2);
    ' "$bb_app" 2>/dev/null || true)
  fi
  version_response=$(curl -fsSL --connect-timeout 5 --max-time 10 "${server_url%/}/install/version" 2>/dev/null || true)
  if [ -n "$version_response" ] && command -v node >/dev/null 2>&1; then
    server_version=$(printf '%s' "$version_response" | node -e '
      let input = "";
      process.stdin.on("data", (chunk) => { input += chunk; });
      process.stdin.on("end", () => {
        const body = JSON.parse(input);
        if (typeof body.version !== "string") process.exit(2);
        process.stdout.write(body.version);
      });
    ' 2>/dev/null || true)
  fi
fi

if [ -n "$bb_app" ] && { [ -z "$server_version" ] || [ "$installed_version" = "$server_version" ]; }; then
  echo "Using bb-app at $bb_app"
else
  if ! command -v node >/dev/null 2>&1; then
    echo "bb-app installation requires Node.js 20.19 or newer (Node.js 22 LTS is recommended)." >&2
    exit 1
  fi
  node_version=$(node -p 'process.versions.node')
  node_supported=$(node -e '
    const [major, minor] = process.versions.node.split(".").map(Number);
    process.exit(major > 20 || (major === 20 && minor >= 19) ? 0 : 1);
  ' && echo yes || echo no)
  if [ "$node_supported" != yes ]; then
    echo "Node.js $node_version is too old; bb-app requires Node.js 20.19 or newer (Node.js 22 LTS is recommended)." >&2
    exit 1
  fi
  if ! command -v npm >/dev/null 2>&1; then
    echo "bb-app installation requires npm." >&2
    exit 1
  fi
  package_url="${server_url%/}/install/bb-app.tgz"
  package_file=$(mktemp "${TMPDIR:-/tmp}/bb-app.XXXXXX.tgz")
  package_status=$(curl -sS -L -o "$package_file" -w '%{http_code}' "$package_url") || {
    rm -f "$package_file"
    echo "Could not download the server's bb-app package from $package_url." >&2
    exit 1
  }
  if [ "$package_status" = 404 ]; then
    rm -f "$package_file"
    echo "The server does not provide its bb-app package; falling back to the npm registry..."
    install_source=bb-app
  elif [ "$package_status" -ge 200 ] && [ "$package_status" -lt 300 ]; then
    install_source=$package_file
    echo "Installing bb-app $server_version from the server..."
  else
    rm -f "$package_file"
    echo "Could not download the server's bb-app package (HTTP $package_status)." >&2
    exit 1
  fi
  if ! npm install -g "$install_source"; then
    rm -f "$package_file"
    echo "Could not install bb-app globally. Fix npm global-install permissions, then rerun this command." >&2
    exit 1
  fi
  rm -f "$package_file"
  if ! command -v bb-app >/dev/null 2>&1; then
    echo "npm installed bb-app, but its global bin directory is not on PATH." >&2
    echo "Add npm's global bin directory to PATH, then rerun this command." >&2
    exit 1
  fi
  bb_app=$(command -v bb-app)
fi

if ! command -v node >/dev/null 2>&1; then
  echo "bb-app requires Node.js, but node is not on PATH." >&2
  exit 1
fi
node_bin=$(command -v node)

data_dir=${BB_DATA_DIR:-"$HOME/.bb"}
mkdir -p "$data_dir"
mkdir -p "$data_dir/logs"

machine_credential=
if [ -n "$machine_code" ]; then
  connect_apex=$(node -e '
    const url = new URL(process.argv[1]);
    const labels = url.hostname.split(".");
    if (labels.length < 3) process.exit(2);
    url.hostname = labels.slice(1).join(".");
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    process.stdout.write(url.origin);
  ' "$server_url") || {
    echo "Could not derive the bb connect apex from $server_url." >&2
    exit 1
  }
  echo "Authorizing this machine with bb connect..."
  redeem_response=$(curl -fsS \
    -X POST \
    -H 'content-type: application/json' \
    --data "{\"code\":\"$machine_code\"}" \
    "$connect_apex/api/connect/redeem-machine") || {
    echo "Could not redeem the bb connect machine code." >&2
    exit 1
  }
  machine_credential=$(printf '%s' "$redeem_response" | node -e '
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      const body = JSON.parse(input);
      if (typeof body.credential !== "string" || !body.credential.startsWith("bbcm_")) {
        process.exit(2);
      }
      process.stdout.write(body.credential);
    });
  ') || {
    echo "The bb connect machine-code response was invalid." >&2
    exit 1
  }
  node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const [dataDir, serverUrl, credential] = process.argv.slice(1);
    const configPath = path.join(dataDir, "config.json");
    let config = {};
    try { config = JSON.parse(fs.readFileSync(configPath, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    config.serverUrl = serverUrl;
    config.machineCredential = credential;
    const temporary = `${configPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, configPath);
  ' "$data_dir" "$server_url" "$machine_credential"
fi

already_joined=no
if [ -f "$data_dir/auth.json" ] && [ -f "$data_dir/config.json" ]; then
  if node -e '
    const fs = require("node:fs");
    const [dataDir, expectedServer, expectedHost] = process.argv.slice(1);
    const auth = JSON.parse(fs.readFileSync(`${dataDir}/auth.json`, "utf8"));
    const config = JSON.parse(fs.readFileSync(`${dataDir}/config.json`, "utf8"));
    const normalize = (value) => String(value).replace(/\/+$/, "");
    process.exit(
      auth.hostId === expectedHost &&
      normalize(config.serverUrl) === normalize(expectedServer) ? 0 : 1
    );
  ' "$data_dir" "$server_url" "$host_id" 2>/dev/null; then
    already_joined=yes
    echo "This machine is already joined to $server_url as $host_id."
  fi
fi

join_pid=
if [ "$already_joined" = no ]; then
  join_log="$data_dir/install-join.log"
  echo "Joining $server_url as $host_id..."
  if [ -n "$machine_credential" ]; then
    machine_args="--machine-credential $machine_credential"
  else
    machine_args=
  fi
  # shellcheck disable=SC2086 -- machine credential tokens contain no spaces.
  BB_DATA_DIR="$data_dir" nohup "$bb_app" host-daemon join \
    --auto-update \
    --join-code "$join_code" \
    --host-id "$host_id" \
    --server-url "$server_url" $machine_args >"$join_log" 2>&1 &
  join_pid=$!
  echo "$join_pid" >"$data_dir/install-daemon.pid"

  joined=no
  attempts=0
  while [ "$attempts" -lt 60 ]; do
    if [ -f "$data_dir/auth.json" ]; then
      joined=yes
      break
    fi
    if ! kill -0 "$join_pid" 2>/dev/null; then
      wait "$join_pid" || true
      echo "bb host daemon exited before enrollment completed. See $join_log" >&2
      exit 1
    fi
    attempts=$((attempts + 1))
    sleep 1
  done
  if [ "$joined" != yes ]; then
    kill "$join_pid" 2>/dev/null || true
    wait "$join_pid" 2>/dev/null || true
    echo "Timed out waiting for enrollment. See $join_log" >&2
    exit 1
  fi
  echo "Joined successfully."
fi

# Tests and source-development smoke runs can leave the enrolled daemon in the
# foreground-supervised process without modifying the user's service manager.
if [ "${BB_INSTALL_SKIP_SERVICE:-0}" = 1 ]; then
  if [ -n "$join_pid" ]; then
    echo "Service installation skipped; daemon PID $join_pid is still running."
  else
    echo "Service installation skipped."
  fi
  exit 0
fi

if [ -n "$join_pid" ]; then
  kill "$join_pid" 2>/dev/null || true
  wait "$join_pid" 2>/dev/null || true
fi
rm -f "$data_dir/install-daemon.pid"

xml_escape() {
  printf '%s' "$1" | sed \
    -e 's/&/\&amp;/g' \
    -e 's/</\&lt;/g' \
    -e 's/>/\&gt;/g' \
    -e 's/"/\&quot;/g' \
    -e "s/'/\\\&apos;/g"
}

systemd_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/%/%%/g'
}

if [ "$platform" = darwin ]; then
  service_dir="$HOME/Library/LaunchAgents"
  service_file="$service_dir/app.getbb.host-daemon.plist"
  mkdir -p "$service_dir"
  escaped_node_bin=$(xml_escape "$node_bin")
  escaped_bb_app=$(xml_escape "$bb_app")
  escaped_server=$(xml_escape "$server_url")
  escaped_data_dir=$(xml_escape "$data_dir")
  cat >"$service_file" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>app.getbb.host-daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>$escaped_node_bin</string>
    <string>$escaped_bb_app</string>
    <string>host-daemon</string>
    <string>--auto-update</string>
    <string>--server-url</string>
    <string>$escaped_server</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>BB_DATA_DIR</key><string>$escaped_data_dir</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$escaped_data_dir/logs/launchd.log</string>
  <key>StandardErrorPath</key><string>$escaped_data_dir/logs/launchd.log</string>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)" "$service_file" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$service_file"
  launchctl kickstart -k "gui/$(id -u)/app.getbb.host-daemon"
  echo "Installed and started launch agent: $service_file"
  echo "Uninstall: launchctl bootout gui/$(id -u) '$service_file' && rm '$service_file'"
else
  service_dir="$HOME/.config/systemd/user"
  service_file="$service_dir/bb-host-daemon.service"
  mkdir -p "$service_dir"
  escaped_node_bin=$(systemd_escape "$node_bin")
  escaped_bb_app=$(systemd_escape "$bb_app")
  escaped_server=$(systemd_escape "$server_url")
  escaped_data_dir=$(systemd_escape "$data_dir")
  cat >"$service_file" <<EOF
[Unit]
Description=bb host daemon
After=network-online.target
Wants=network-online.target

[Service]
ExecStart="$escaped_node_bin" "$escaped_bb_app" host-daemon --auto-update --server-url "$escaped_server"
Environment="BB_DATA_DIR=$escaped_data_dir"
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now bb-host-daemon.service
  echo "Installed and started systemd user service: $service_file"
  echo "It starts with your systemd user session."
  echo "Uninstall: systemctl --user disable --now bb-host-daemon.service && rm '$service_file' && systemctl --user daemon-reload"
fi
