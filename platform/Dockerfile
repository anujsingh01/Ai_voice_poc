# syntax=docker/dockerfile:1.7
# Two images from one build:
#   web   the Next.js app (standalone server, ~200 MB), behind the load balancer
#   jobs  scoring worker, maintenance (retention) worker and database migrations
# Both run as a non-root user and trust the Amazon RDS CA so DATABASE_SSL=verify-full works.

FROM node:26.13-trixie-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /usr/local/share/rds-global-bundle.pem
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/rds-global-bundle.pem

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
RUN npm run build

FROM base AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server.js"]

FROM base AS jobs
ENV NODE_ENV=production
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json tsconfig.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node db ./db
USER node
# Override per service: scoring-worker | maintenance-worker | message-worker | migrate
ENTRYPOINT ["npx", "tsx"]
CMD ["scripts/scoring-worker.mts"]
