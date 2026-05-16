# Multi-stage build for the events engine. Mirrors gps-ingestor for
# consistency — small Alpine final image, non-root user, ~15 MB.

FROM golang:1.22-alpine AS build
WORKDIR /src

RUN apk add --no-cache git ca-certificates

COPY go.mod go.sum* ./
COPY . .
RUN go mod tidy && \
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -trimpath -ldflags="-s -w" -o /out/events-engine ./cmd/engine

FROM alpine:3.20
RUN apk add --no-cache ca-certificates wget tzdata && \
    addgroup -S fleex && adduser -S fleex -G fleex
USER fleex
WORKDIR /app
COPY --from=build /out/events-engine /app/events-engine

EXPOSE 9091
ENTRYPOINT ["/app/events-engine"]
