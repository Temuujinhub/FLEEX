# Self-contained build for the isolated FMC125 + DualCam test rig.
# Pure stdlib Go (no external modules) so the build needs no network.
FROM golang:1.22-alpine AS build
WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /camtest .

FROM alpine:3.20
RUN adduser -D -u 10001 camtest && mkdir -p /app/data && chown -R camtest /app
WORKDIR /app
COPY --from=build /camtest /app/camtest
USER camtest
EXPOSE 5028 5029 8090
ENTRYPOINT ["/app/camtest"]
