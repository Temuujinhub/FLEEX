# Multi-stage build for the DualCam media service.

FROM golang:1.22-alpine AS build
WORKDIR /src

RUN apk add --no-cache git ca-certificates

COPY go.mod go.sum* ./
COPY . .
RUN go mod tidy && \
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -trimpath -ldflags="-s -w" -o /out/media-service ./cmd/media

FROM alpine:3.20
RUN apk add --no-cache ca-certificates wget tzdata && \
    addgroup -g 10001 -S media && adduser -u 10001 -S media -G media && \
    mkdir -p /data/media && chown -R media:media /data/media
WORKDIR /app
COPY --from=build /out/media-service /app/media-service
# Non-root (audit H6): a memory-safety bug in the DualCam parser is no longer
# container-root. A FRESH named volume mounted at /data/media inherits this
# ownership from the image, so the media user can write blobs (0644 = readable
# by the non-root API). NOTE: upgrading an EXISTING root-owned volume needs a
# one-time `chown -R 10001:10001 <volume>` on the host (see DEPLOYMENT.md).
USER media
EXPOSE 5029 9092
ENTRYPOINT ["/app/media-service"]
