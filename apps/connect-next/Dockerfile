FROM node:24-bookworm-slim AS build
WORKDIR /build
RUN npm install --no-save --no-audit --no-fund esbuild@0.28.1 drizzle-orm@0.38.4
COPY apps/connect-next/src ./apps/connect-next/src
COPY packages/tunnel-contract/src ./packages/tunnel-contract/src
COPY packages/connect-db/src ./packages/connect-db/src
COPY packages/text-utils/src ./packages/text-utils/src
RUN npx esbuild apps/connect-next/src/main.ts --bundle --platform=node --format=esm \
  --target=node24 --outfile=gate.mjs \
  --alias:@bb/tunnel-contract/next=./packages/tunnel-contract/src/next.ts \
  --alias:@bb/connect-db=./packages/connect-db/src/index.ts \
  --alias:@bb/text-utils=./packages/text-utils/src/index.ts

FROM node:24-bookworm-slim
ARG FRP_VERSION=0.71.0
ARG FRP_SHA256=84f27e39f11169f7adcef8e8b70c9329de17747b1f14dad9fb95eef5682ea716
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL -o /tmp/frp.tar.gz \
    "https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/frp_${FRP_VERSION}_linux_amd64.tar.gz" \
  && echo "${FRP_SHA256}  /tmp/frp.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/frp.tar.gz -C /usr/local/bin --strip-components=1 \
    "frp_${FRP_VERSION}_linux_amd64/frps" \
  && rm /tmp/frp.tar.gz \
  && apt-get purge -y curl \
  && apt-get autoremove -y
WORKDIR /app
COPY --from=build /build/gate.mjs ./gate.mjs
ENV NODE_ENV=production FRPS=/usr/local/bin/frps OPEN_FILES_LIMIT=65536
EXPOSE 8080
CMD ["sh", "-c", "ulimit -n \"$OPEN_FILES_LIMIT\" && exec setpriv --reuid=node --regid=node --init-groups node gate.mjs"]
