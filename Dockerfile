# syntax=docker/dockerfile:1
# Build stages run on the build machine's platform; Go cross-compiles for the target, so arm64 images need no emulation.

FROM --platform=$BUILDPLATFORM node:24-slim AS web
ARG VERSION=dev
WORKDIR /src/web
RUN npm install -g pnpm@10.33.2
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN GIT_SHA=$VERSION pnpm build

FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS server
ARG TARGETOS TARGETARCH VERSION=dev
WORKDIR /src/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
COPY --from=web /src/web/dist/ ./internal/webui/dist/
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags "-s -w -X main.version=$VERSION" -o /out/wallet ./cmd/wallet \
 && mkdir -p /out/data

FROM gcr.io/distroless/static-debian13:nonroot
COPY --from=server /out/wallet /wallet
# Owned by the distroless nonroot user so a fresh named volume is writable.
COPY --from=server --chown=65532:65532 /out/data /data
ENV DATA_DIR=/data PORT=8080
VOLUME /data
EXPOSE 8080
USER nonroot
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s CMD ["/wallet", "healthcheck"]
ENTRYPOINT ["/wallet"]
CMD ["serve"]
