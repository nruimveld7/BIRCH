# ---- Build stage ----
FROM node:20-bookworm AS build
WORKDIR /app

# Corporate CA (keep this because your network MITMs TLS)
COPY docker/certs/*.crt /usr/local/share/ca-certificates/
RUN update-ca-certificates
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

# Vendored Yarn 4 (no corepack, no npmjs.org)
COPY .yarnrc.yml package.json yarn.lock ./
COPY .yarn/releases/ ./.yarn/releases/

RUN node .yarn/releases/yarn-4.10.3.cjs install --immutable

# App source + build
COPY . .
RUN node .yarn/releases/yarn-4.10.3.cjs build


# ---- Runtime stage ----
FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

# Install CA tooling + update store
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Corporate CA runtime
COPY docker/certs/*.crt /usr/local/share/ca-certificates/
RUN update-ca-certificates
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

# Copy the built output + deps needed to run
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/scripts ./scripts

EXPOSE 3000
CMD ["node", "build"]
