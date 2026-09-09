FROM node:22.19.0-bookworm-slim@sha256:4a4884e8a44826194dff92ba316264f392056cbe243dcc9fd3551e71cea02b90
RUN apt-get update && apt-get install -y --no-install-recommends git gh curl ca-certificates build-essential python3 ripgrep jq && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@9.15.0 @openai/codex@0.153.4 @anthropic-ai/claude-code@2.1.263 && npm cache clean --force
USER node
WORKDIR /home/node
