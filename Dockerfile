# Modified from AionUI by WINK GO contributors in 2026.
FROM node:22-bookworm-slim AS builder

ARG TARGETARCH
ENV PATH="/root/.cargo/bin:${PATH}"
WORKDIR /app

# Build the same standalone WebUI bundle used by GitHub Releases. Rust is
# required when no prebuilt winkgo_core release is available for the commit.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      build-essential \
      ca-certificates \
      clang \
      cmake \
      curl \
      git \
      libssl-dev \
      pkg-config \
      python3 \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global bun@1.3.11 \
    && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --profile minimal --default-toolchain 1.95.0

COPY . .
RUN bun install --frozen-lockfile
RUN WINKGO_EDITION=free NODE_OPTIONS=--max-old-space-size=8192 \
    bunx electron-vite build --config packages/desktop/electron.vite.config.ts
RUN case "${TARGETARCH:-amd64}" in \
      amd64) export PACK_ARCH=x64 ;; \
      arm64) export PACK_ARCH=arm64 ;; \
      *) echo "Unsupported Docker architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && PACK_PLATFORM=linux node scripts/pack-web-cli.js \
    && mkdir -p /bundle \
    && tar -xzf "dist-web-cli/winkgo-web-$(node -p "require('./package.json').version")-linux-$([ "$PACK_ARCH" = x64 ] && echo x86_64 || echo arm64).tar.gz" \
      -C /bundle

FROM debian:bookworm-slim AS runtime

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libicu-dev \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /bundle/winkgo-web/ ./

ENV WINKGO_PORT=25808
ENV WINKGO_ALLOW_REMOTE=1
ENV WINKGO_DATA_DIR=/data

VOLUME ["/data"]
EXPOSE 25808

ENTRYPOINT ["./winkgo-web"]
CMD ["start", "--remote", "--data-dir", "/data", "--no-open"]
