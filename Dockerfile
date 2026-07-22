# Same base image in both stages: better-sqlite3/sharp native binaries must
# match the runtime ABI. Debian-slim (glibc) gets prebuilds; Alpine would not.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production \
    BETTS_DATA_DIR=/data \
    PORT=3000 \
    HOST=0.0.0.0
WORKDIR /app
COPY --from=build /app/.output ./.output
# Migrations ship with the image and run on boot (server plugin).
COPY --from=build /app/drizzle ./drizzle
COPY docker/entrypoint.sh /entrypoint.sh
RUN useradd -r -m betts && mkdir -p /data && chown -R betts /data && chmod +x /entrypoint.sh
USER betts
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", ".output/server/index.mjs"]
