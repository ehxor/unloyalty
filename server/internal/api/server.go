// Package api is the HTTP layer: JSON API under /api and the embedded PWA everywhere else.
package api

import (
	"context"
	"errors"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/ehxor/unloyalty/server/internal/auth"
	"github.com/ehxor/unloyalty/server/internal/config"
	"github.com/ehxor/unloyalty/server/internal/store"
)

const maxBodyBytes = 1 << 20

type Options struct {
	Store   *store.Store
	Config  config.Config
	Version string
	// Web is the built PWA (index.html at the root).
	Web    fs.FS
	Logger *slog.Logger
	// Now is the clock; nil means time.Now.
	Now func() time.Time
}

type Server struct {
	store   *store.Store
	cfg     config.Config
	version string
	web     fs.FS
	log     *slog.Logger
	now     func() time.Time
	limiter *auth.RateLimiter
}

func New(o Options) *Server {
	s := &Server{
		store:   o.Store,
		cfg:     o.Config,
		version: o.Version,
		web:     o.Web,
		log:     o.Logger,
		now:     o.Now,
		// 5 attempts at once, then one every 12 s (per client IP) for login and registration.
		limiter: auth.NewRateLimiter(5, 12*time.Second),
	}
	if s.now == nil {
		s.now = time.Now
	}
	if s.log == nil {
		s.log = slog.Default()
	}
	return s
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.handleHealth)
	mux.HandleFunc("GET /api/config", s.handleConfig)
	mux.HandleFunc("POST /api/auth/register", s.handleRegister)
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	mux.HandleFunc("POST /api/auth/logout", s.requireUser(s.handleLogout))
	mux.HandleFunc("GET /api/me", s.requireUser(s.handleMe))
	mux.HandleFunc("POST /api/sync", s.requireUser(s.handleSync))
	mux.HandleFunc("GET /api/export", s.requireUser(s.handleExport))
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, codeNotFound, "No such API endpoint")
	})
	mux.Handle("/", s.staticHandler())
	return s.recoverer(s.logRequests(s.securityHeaders(s.limitBody(mux))))
}

// clientIP is the address used for rate limiting: the TCP peer, or the first X-Forwarded-For hop
// when the server sits behind a trusted proxy.
func (s *Server) clientIP(r *http.Request) string {
	if s.cfg.TrustProxyHeaders {
		if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
			first, _, _ := strings.Cut(fwd, ",")
			return strings.TrimSpace(first)
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

const contentSecurityPolicy = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; " +
	"img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; " +
	"object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", contentSecurityPolicy)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Permissions-Policy", "camera=(self), screen-wake-lock=(self)")
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		// Only a trusted proxy can tell us the client connection was HTTPS.
		if s.cfg.TrustProxyHeaders && r.Header.Get("X-Forwarded-Proto") == "https" {
			h.Set("Strict-Transport-Security", "max-age=31536000")
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) limitBody(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
		next.ServeHTTP(w, r)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func (r *statusRecorder) Unwrap() http.ResponseWriter { return r.ResponseWriter }

// logRequests logs method, path, status and duration. Never bodies or query strings: card data stays out of logs.
// Successful health checks (every 30 s from Docker) aren't logged.
func (s *Server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		if r.URL.Path == "/api/health" && rec.status == http.StatusOK {
			return
		}
		s.log.Info("request", "method", r.Method, "path", r.URL.Path, "status", rec.status, "duration", time.Since(start).Round(time.Microsecond))
	})
}

func (s *Server) recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				if v == http.ErrAbortHandler {
					panic(v)
				}
				s.log.Error("panic", "path", r.URL.Path, "error", v)
				writeError(w, http.StatusInternalServerError, codeInternal, "Internal error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

type userKey struct{}

func userFrom(ctx context.Context) store.User { return ctx.Value(userKey{}).(store.User) }

// requireUser resolves the Bearer token to a user or answers 401.
func (s *Server) requireUser(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || token == "" {
			writeError(w, http.StatusUnauthorized, codeUnauthorized, "Sign in required")
			return
		}
		user, err := s.store.SessionUser(r.Context(), auth.HashToken(token), s.now(), s.cfg.SessionTTL)
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusUnauthorized, codeUnauthorized, "Session expired or invalid")
			return
		}
		if err != nil {
			s.internalError(w, r, err)
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), userKey{}, user)))
	}
}

func (s *Server) internalError(w http.ResponseWriter, r *http.Request, err error) {
	s.log.Error("internal error", "path", r.URL.Path, "error", err)
	writeError(w, http.StatusInternalServerError, codeInternal, "Internal error")
}
