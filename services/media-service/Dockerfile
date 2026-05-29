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
RUN apk add --no-cache ca-certificates wget tzdata
# Runs as root so it can write captured blobs to the mounted media volume
# (named volumes are root-owned). Blobs are written 0644 so the API (non-root)
# can read them. The service only listens on the internal camera + health
# ports and writes media — no shell, minimal surface.
WORKDIR /app
COPY --from=build /out/media-service /app/media-service

EXPOSE 5029 9092
ENTRYPOINT ["/app/media-service"]
