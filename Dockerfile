# Luna Trade — image kecil, multi-stage.
#
# JALUR DEPLOY SEBENARNYA BUKAN INI. Produksi memakai auto-pull di EC2 (systemd
# `luna-deploy.timer` → build native arm64 → sync aset → restart), tanpa Docker sama sekali —
# lihat deploy/luna-deploy.sh. Dockerfile ini disimpan sebagai jalur alternatif (mis. pindah host
# atau menjalankan lokal di container), dan sengaja dibuat BISA di-build supaya tak jadi jebakan:
# versi sebelumnya `COPY main.go` saja padahal repo punya 28 file .go + paket internal/, jadi
# `docker build` dijamin gagal — dan tak ada yang tahu karena tak ada yang pernah menjalankannya.

# ── Stage 1: build ──────────────────────────────────────────────────────────
# Versi Go mengikuti go.mod (1.25). Alpine + CGO off → binary statis untuk base distroless.
FROM golang:1.25-alpine AS build
WORKDIR /src

# Dependency di-VENDOR di repo → tak ada `go mod download`, build jalan tanpa jaringan.
COPY go.mod go.sum ./
COPY vendor ./vendor

# Seluruh paket, bukan cuma main.go: paket root (28 file) + internal/.
COPY *.go ./
COPY internal ./internal

RUN CGO_ENABLED=0 GOOS=linux go build -mod=vendor -ldflags="-s -w" -o /bar-replay .

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM gcr.io/distroless/static-debian12
WORKDIR /app

# Binary + aset statis (FileServer serve dari working dir "/app").
# URUTAN aset tak penting di sini (image dibangun sekali, bukan disinkron bertahap seperti di
# luna-deploy.sh), tapi daftarnya harus LENGKAP: js/ & css/ hasil pemecahan index.html — tanpa
# salah satunya, halaman memuat tapi aplikasinya separuh mati tanpa error.
COPY --from=build /bar-replay /app/bar-replay
COPY index.html /app/index.html
COPY css /app/css
COPY js /app/js
COPY assets /app/assets

# Token & kredensial basic-auth disuntik saat run (-e ...), jangan di-bake ke image.
# BASIC_AUTH_USER + BASIC_AUTH_PASS: kalau kosong, auth dilewati (dev lokal).
ENV OANDA_ENV=practice
ENV PORT=8765
EXPOSE 8765

ENTRYPOINT ["/app/bar-replay"]
