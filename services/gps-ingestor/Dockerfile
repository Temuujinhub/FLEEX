# Multi-stage build for the GPS ingestor.
# Final image is distroless-ish (scratch + ca-certs) and ~15MB.

FROM golang:1.25-alpine AS build
WORKDIR /src

RUN apk add --no-cache git ca-certificates

COPY go.mod go.sum* ./
COPY . .
# Resolve deps & build. `go mod tidy` produces go.sum on the fly so the repo
# can ship without one — handy for first-time clones where deps still float.
RUN go mod tidy && \
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -trimpath -ldflags="-s -w" -o /out/gps-ingestor ./cmd/ingestor

FROM alpine:3.20
RUN apk add --no-cache ca-certificates wget tzdata && \
    addgroup -S fleex && adduser -S fleex -G fleex
USER fleex
WORKDIR /app
COPY --from=build /out/gps-ingestor /app/gps-ingestor

EXPOSE 5027 9090
ENTRYPOINT ["/app/gps-ingestor"]
