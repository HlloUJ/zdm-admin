# Independent test toolchain; no application sources, data, tokens or runtime mounts.
FROM node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS node
FROM ubuntu:24.04@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac
COPY --from=node /usr/local/ /usr/local/
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && sed -i 's|http://archive.ubuntu.com|https://archive.ubuntu.com|g; s|http://security.ubuntu.com|https://security.ubuntu.com|g' /etc/apt/sources.list.d/ubuntu.sources \
    && printf 'Acquire::http::Timeout "30";\nAcquire::https::Timeout "30";\nAcquire::Retries "1";\nAPT::Update::Error-Mode "any";\n' > /etc/apt/apt.conf.d/99zdm-ci-network \
    && apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git gh sudo unzip libstdc++6
WORKDIR /opt/zdm-tools
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts \
    && npx --no-install playwright install --with-deps chrome \
    && npx --no-install playwright install-deps chrome --dry-run
COPY inventory.mjs ./inventory.mjs
ARG SOURCE_REVISION
ARG SOURCE_RUN
LABEL org.opencontainers.image.source="https://github.com/HlloUJ/zdm-admin" \
      org.opencontainers.image.revision="${SOURCE_REVISION}"
RUN SOURCE_REVISION="${SOURCE_REVISION}" SOURCE_RUN="${SOURCE_RUN}" node inventory.mjs write
WORKDIR /workspace
CMD ["bash"]
