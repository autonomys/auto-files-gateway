# The build output is plain JavaScript and YAML, so it is built once on the
# build platform and copied into every target platform's SubQuery node image.
FROM --platform=$BUILDPLATFORM node:24.22.2-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS build

ENV YARN_ENABLE_TELEMETRY=0
WORKDIR /src
COPY . .

RUN node .yarn/releases/yarn-4.2.2.cjs install --immutable --mode=skip-build

# project.ts bakes CHAIN_ID, START_BLOCK and RPC_ENDPOINTS into the manifest at
# build time. RPC_ENDPOINTS stays unset: the endpoint is given at runtime with
# --network-endpoint. The mapping does not depend on them, and cmp fails the
# build if the two networks' bundles ever differ.
RUN set -eu; \
    mkdir -p /out/dist; \
    for network in \
        mainnet:0x66455a580aabff303720aa83adbe6c44502922251c03ba73686d5245da9e21bd \
        chronos:0x91912b429ce7bf2975440a0920b46a892fddeeaed6ccc11c93f2d57ad1bd69ab; do \
      name=${network%%:*}; \
      rm -rf services/dag-indexer/dist services/dag-indexer/project.yaml; \
      CHAIN_ID=${network#*:} START_BLOCK=1 node .yarn/releases/yarn-4.2.2.cjs dag-indexer build; \
      mv services/dag-indexer/project.yaml "/out/project.$name.yaml"; \
      if [ -e /out/dist/index.js ]; then \
        cmp services/dag-indexer/dist/index.js /out/dist/index.js; \
      else \
        cp services/dag-indexer/dist/index.js /out/dist/index.js; \
      fi; \
    done; \
    cp services/dag-indexer/schema.graphql /out/

FROM ghcr.io/autonomys/subql-node-substrate:v0.3.1@sha256:6e89be7594987d3d3b329a755a94c8dfccaf5c195a439f6209f4aab74d1d1e2b

COPY --from=build /out /app
