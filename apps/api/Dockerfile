FROM docker.io/library/golang:1.26-alpine AS builder

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/beo-api ./cmd/server

FROM docker.io/library/alpine:3.21

WORKDIR /app
RUN apk add --no-cache ca-certificates
COPY --from=builder /out/beo-api /app/beo-api
COPY --from=builder /src/migrations /app/migrations

ENV PORT=8080
ENV MIGRATIONS_DIR=/app/migrations
EXPOSE 8080

CMD ["/app/beo-api"]
