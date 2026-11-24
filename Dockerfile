# Selene web simulator — static site served by nginx.
# Build stage bundles shared/ + web/ into a single offline-capable page (no npm dependencies).
FROM node:22-alpine AS build
WORKDIR /src
COPY shared ./shared
COPY web ./web
COPY assets ./assets
RUN node web/build.mjs --pwa --csp=/src/csp.conf

FROM nginx:1.27-alpine
LABEL org.opencontainers.image.title="Selene" \
      org.opencontainers.image.description="Moon-data LCD watch simulator (moon phase arc, moon times, sunrise/sunset, alarm, stopwatch)" \
      org.opencontainers.image.source="https://github.com/au12/selene" \
      org.opencontainers.image.licenses="MIT"
COPY docker/nginx-main.conf /etc/nginx/nginx.conf
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /src/csp.conf /etc/nginx/csp.conf
COPY --from=build /src/dist/ /usr/share/nginx/html/
# unprivileged from here on: runs fine with --read-only, --cap-drop=ALL and a tmpfs on /tmp
ENV NGINX_ENTRYPOINT_QUIET_LOGS=1
USER nginx
EXPOSE 80
HEALTHCHECK --interval=60s --timeout=3s CMD wget -qO- http://127.0.0.1/healthz || exit 1
