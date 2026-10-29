// Command wallet is the Unloyalty server: `serve` (default), `healthcheck` and `create-user`.
package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"golang.org/x/term"

	"github.com/ehxor/unloyalty/server/internal/api"
	"github.com/ehxor/unloyalty/server/internal/auth"
	"github.com/ehxor/unloyalty/server/internal/config"
	"github.com/ehxor/unloyalty/server/internal/store"
	"github.com/ehxor/unloyalty/server/internal/webui"
)

// version is set at build time: -ldflags "-X main.version=…".
var version = "dev"

const usage = `usage: wallet [command]

commands:
  serve                  run the server (default)
  healthcheck            exit 0 if the local server answers /api/health (for Docker HEALTHCHECK)
  create-user <username> add an account; password from WALLET_PASSWORD or prompted
  version                print the version

environment: PORT (8080), DATA_DIR (/data), ALLOW_REGISTRATION (false), SESSION_TTL (90d), TRUST_PROXY_HEADERS (false)
`

func main() {
	cmd := "serve"
	if len(os.Args) > 1 {
		cmd = os.Args[1]
	}
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		fatal(err)
	}
	switch cmd {
	case "serve":
		err = serve(cfg)
	case "healthcheck":
		err = healthcheck(cfg)
	case "create-user":
		if len(os.Args) != 3 {
			fatal(errors.New("usage: wallet create-user <username>"))
		}
		err = createUser(cfg, os.Args[2])
	case "version":
		fmt.Println(version)
	case "help", "-h", "--help":
		fmt.Print(usage)
	default:
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	if err != nil {
		fatal(err)
	}
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "wallet:", err)
	os.Exit(1)
}

func openStore(cfg config.Config) (*store.Store, error) {
	if err := os.MkdirAll(cfg.DataDir, 0o700); err != nil {
		return nil, err
	}
	return store.Open(filepath.Join(cfg.DataDir, "wallet.db"))
}

func serve(cfg config.Config) error {
	log := slog.New(slog.NewTextHandler(os.Stdout, nil))
	st, err := openStore(cfg)
	if err != nil {
		return err
	}
	defer st.Close()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go purgeSessions(ctx, st, cfg.SessionTTL, log)

	srv := &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.Port),
		Handler:           api.New(api.Options{Store: st, Config: cfg, Version: version, Web: webui.FS(), Logger: log}).Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	errc := make(chan error, 1)
	go func() { errc <- srv.ListenAndServe() }()
	log.Info("listening", "addr", srv.Addr, "version", version, "data", cfg.DataDir, "registration", cfg.AllowRegistration)

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	log.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}

func purgeSessions(ctx context.Context, st *store.Store, ttl time.Duration, log *slog.Logger) {
	ticker := time.NewTicker(6 * time.Hour)
	defer ticker.Stop()
	for {
		if n, err := st.PurgeExpiredSessions(ctx, time.Now(), ttl); err != nil {
			log.Error("purge sessions", "error", err)
		} else if n > 0 {
			log.Info("purged expired sessions", "count", n)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func healthcheck(cfg config.Config) error {
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/api/health", cfg.Port))
	if err != nil {
		return err
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("health: %s", resp.Status)
	}
	return nil
}

func createUser(cfg config.Config, username string) error {
	password := os.Getenv("WALLET_PASSWORD")
	if password == "" {
		var err error
		if password, err = promptPassword(); err != nil {
			return err
		}
	}
	username = strings.ToLower(strings.TrimSpace(username))
	if err := api.ValidateCredentials(username, password); err != nil {
		return err
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return err
	}
	st, err := openStore(cfg)
	if err != nil {
		return err
	}
	defer st.Close()
	user, err := st.CreateUser(context.Background(), username, hash, false, time.Now())
	if err != nil {
		return err
	}
	fmt.Printf("created user %s (%s)\n", user.Username, user.ID)
	return nil
}

func promptPassword() (string, error) {
	fd := int(os.Stdin.Fd())
	if !term.IsTerminal(fd) {
		// Piped: read one line, e.g. `echo "$PW" | wallet create-user alice`.
		line, err := bufio.NewReader(os.Stdin).ReadString('\n')
		if err != nil && line == "" {
			return "", errors.New("no password: set WALLET_PASSWORD or pipe it on stdin")
		}
		return strings.TrimRight(line, "\r\n"), nil
	}
	fmt.Fprint(os.Stderr, "Password: ")
	first, err := term.ReadPassword(fd)
	fmt.Fprintln(os.Stderr)
	if err != nil {
		return "", err
	}
	fmt.Fprint(os.Stderr, "Repeat password: ")
	second, err := term.ReadPassword(fd)
	fmt.Fprintln(os.Stderr)
	if err != nil {
		return "", err
	}
	if string(first) != string(second) {
		return "", errors.New("passwords don't match")
	}
	return string(first), nil
}
