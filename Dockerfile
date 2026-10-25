# syntax=docker/dockerfile:1
FROM oven/bun:1.4.4 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json tsconfig.seekrss.json ./
COPY src/ ./src/

RUN bun run build

FROM oven/bun:1.4.4 AS production-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.4 AS release
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3010 DATABASE_PATH=/app/data/seekrss.db
COPY --from=production-deps --chown=bun:bun /app/node_modules ./node_modules
COPY --from=build --chown=bun:bun /app/dist ./dist
COPY --chown=bun:bun public/ ./public/
COPY --chown=bun:bun scripts/backup.ts ./scripts/backup.ts
COPY --chown=bun:bun package.json LICENSE ./
RUN mkdir -p /app/data && chown bun:bun /app/data && chmod 700 /app/data
USER bun
EXPOSE 3010
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 CMD bun -e 'const r=await fetch("http://127.0.0.1:"+(process.env.PORT||3010)+"/health");process.exit(r.ok?0:1)'
CMD ["bun", "run", "dist/server.js"]
