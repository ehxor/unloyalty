VERSION ?= $(shell git describe --always --dirty 2>/dev/null || echo dev)
EMBED_DIR := server/internal/webui/dist
IMAGE ?= unloyalty:dev

.PHONY: install dev web embed server run test test-web test-server e2e check icons screenshots image budgets

install:
	cd web && pnpm install --frozen-lockfile

dev:
	cd web && pnpm dev

web:
	cd web && pnpm build

# Copy the built PWA into the Go embed directory (keeping the .keep placeholder).
embed: web
	find $(EMBED_DIR) -mindepth 1 ! -name .keep -delete
	cp -R web/dist/. $(EMBED_DIR)/

server: embed
	cd server && CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=$(VERSION)" -o ../bin/wallet ./cmd/wallet

# Local run with data in ./data; first registration creates the account.
run: server
	DATA_DIR=./data ./bin/wallet serve

test: test-web test-server

test-web:
	cd web && pnpm typecheck && pnpm test

test-server:
	cd server && go vet ./... && go test ./...

# Playwright against the real Go binary (CSP, static serving and caching as deployed).
e2e:
	cd web && pnpm e2e

check: test e2e

icons:
	cd web && pnpm icons

# Regenerate docs/screenshots/*.png (README) against the real server with seeded cards.
screenshots:
	rm -f docs/screenshots/*.png
	cd web && pnpm screenshots

image:
	docker build --build-arg VERSION=$(VERSION) -t $(IMAGE) .

budgets: image
	IMAGE=$(IMAGE) ./scripts/check-budgets.sh
