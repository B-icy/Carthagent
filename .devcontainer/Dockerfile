FROM mcr.microsoft.com/devcontainers/javascript-node:1-24-bookworm

ARG BUN_VERSION=1.4.2

# tmux drives the native terminal UI in interactive QA (docs/interactive-qa.md).
RUN apt-get update \
  && apt-get install -y --no-install-recommends tmux unzip \
  && rm -rf /var/lib/apt/lists/*

ENV BUN_INSTALL=/usr/local/bun
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}" \
  && ln -s /usr/local/bun/bin/bun /usr/local/bin/bun \
  && bun --version | grep -qx "${BUN_VERSION}"
