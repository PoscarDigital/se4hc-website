# Public website: build the static site, serve it with nginx.
# Content and data come from the repo, so the image is a complete, immutable
# snapshot of the site at one commit. Built in CI (see .github/workflows).

FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# `astro check` runs here: content that violates the schema fails the build,
# so a bad edit never produces an image and the server keeps serving the last
# good one.
RUN npm run build

FROM nginx:alpine AS runtime
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
# Addressed as 127.0.0.1, not localhost: localhost resolves to ::1 first in
# these images and neither server listens on IPv6, so the probe would fail
# against a perfectly healthy container.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
