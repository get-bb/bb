filters=()
if [[ "$APP_SHARD" == "true" ]]; then
  filters=(--filter bb --filter '@bb/app...' --filter '@bb/db...')
elif [[ "$SERVER_SHARD" == "true" ]]; then
  filters=(--filter bb --filter '@bb/server...' --filter '@bb/host-daemon...' --filter '@bb/app...' --filter 'bb-plugin-*...')
elif [[ "$PLUGIN_SHARD" == "true" || "$OTHER_PACKAGES_SHARD" == "true" ]]; then
  read -r -a selected_filters <<< "$TEST_FILTERS"
  selection=$(pnpm list "${selected_filters[@]}" --depth -1 --json)
  packages=$(node -e 'const fs = require("node:fs"); for (const pkg of JSON.parse(process.argv[1])) { if (process.env.OTHER_PACKAGES_SHARD !== "true" || JSON.parse(fs.readFileSync(`${pkg.path}/package.json`, "utf8")).scripts?.test) console.log(pkg.name); }' "$selection")
  filters=(--filter bb --filter '@bb/app...' --filter '@bb/db...')
  if [[ "$OTHER_PACKAGES_SHARD" == "true" ]]; then
    filters+=(--filter '@bb/server...' --filter '@bb/cli...' --filter 'bb-plugin-provider-*...')
  fi
  while IFS= read -r package; do
    filters+=(--filter "$package...")
  done <<< "$packages"
elif [[ "$MOBILE_TESTS" != "true" ]]; then
  filters=(--filter '!@bb/mobile')
fi
bash .github/actions/setup-workspace/install-dependencies.sh --ignore-scripts "${filters[@]}"
