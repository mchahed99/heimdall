FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock* ./
COPY packages/core/package.json packages/core/
COPY packages/proxy/package.json packages/proxy/
COPY packages/cli/package.json packages/cli/
COPY packages/hooks/package.json packages/hooks/

RUN bun install --frozen-lockfile

COPY packages/core/ packages/core/
COPY packages/proxy/ packages/proxy/
COPY packages/cli/ packages/cli/
COPY packages/hooks/ packages/hooks/

ENTRYPOINT ["bun", "run", "packages/cli/src/index.ts"]
CMD ["guard", "--help"]
