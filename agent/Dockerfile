FROM node:22-slim

# node:22-slim ships without system CA certificates. Node's own fetch is fine
# (bundled CAs), but @livekit/rtc-node's native Rust core reads the SYSTEM
# trust store — without this, every TLS request it makes fails with
# "failed to retrieve region info: error sending request".
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# npm ci against the lockfile for reproducible builds. Dev deps are included
# on purpose: the worker runs straight from src via tsx (a devDependency).
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src ./src

ENV NODE_ENV=production

CMD ["npx", "tsx", "src/index.ts", "start"]
