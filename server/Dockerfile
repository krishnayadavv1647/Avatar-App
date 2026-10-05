# The agent worker, as LiveKit Cloud runs it (`lk agent create` / `lk agent deploy`
# from this folder). Only the worker runs here - the API stays on its own host.
#
# LiveKit Cloud injects LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET;
# everything else (Mongo, LemonSlice, R2, JWT secrets...) comes from the
# deployment's secrets. See docs/AGENT_DEPLOY.md.

ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-slim

# The LiveKit SDK verifies TLS with the system CA store.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app

# Dependencies first, so a code change does not reinstall them. Production
# only: the worker needs neither the test database nor the pretty logger.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

# Not root.
USER node

# `start` connects the worker to LiveKit and waits for jobs (production mode).
CMD ["node", "src/agent/worker.js", "start"]
