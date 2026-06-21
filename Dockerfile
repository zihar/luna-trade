# Luna Trade — image kecil untuk deploy numpang di instance alertd.
#
# Multi-stage: build binary statis di stage golang, lalu salin ke base
# distroless (sudah bawa ca-certificates untuk panggil HTTPS OANDA).
# Hasil akhir ~10 MB, idle nyaris tanpa RAM/CPU.

# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM golang:1.21-alpine AS build
WORKDIR /src

# Cache layer dependency (di sini cuma stdlib, tapi tetap rapi).
COPY go.mod ./
RUN go mod download

COPY main.go ./
# CGO off → binary statis, bisa jalan di base distroless/static.
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /bar-replay .

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM gcr.io/distroless/static-debian12
WORKDIR /app

# Binary + aset statis (FileServer serve dari working dir "/app").
COPY --from=build /bar-replay /app/bar-replay
COPY index.html /app/index.html
COPY assets /app/assets

# Token & kredensial basic-auth disuntik saat run (-e ...), jangan di-bake ke image.
# BASIC_AUTH_USER + BASIC_AUTH_PASS: kalau kosong, auth dilewati (dev lokal).
ENV OANDA_ENV=practice
ENV PORT=8765
EXPOSE 8765

ENTRYPOINT ["/app/bar-replay"]
