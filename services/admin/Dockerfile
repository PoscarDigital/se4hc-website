# Admin portal. Accounts live in Postgres; content is read from and written to
# GitHub, so this container holds no content state of its own.

FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# Dependencies first, so a source change does not re-resolve the tree.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY src ./src
COPY public ./public

# Drop privileges: nothing here needs to write to the filesystem at runtime.
USER node

EXPOSE 3000
# Addressed as 127.0.0.1, not localhost: localhost resolves to ::1 first in
# these images and neither server listens on IPv6, so the probe would fail
# against a perfectly healthy container.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null || exit 1

CMD ["node", "src/server.js"]
