package api

import (
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/ehxor/unloyalty/server/internal/auth"
	"github.com/ehxor/unloyalty/server/internal/store"
)

// maxSyncChanges caps one sync round; clients send larger backlogs in batches.
const maxSyncChanges = 500

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if err := s.store.Ping(r.Context()); err != nil {
		writeError(w, http.StatusServiceUnavailable, codeInternal, "Database unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "version": s.version})
}

func (s *Server) registrationOpen(r *http.Request) (bool, error) {
	if s.cfg.AllowRegistration {
		return true, nil
	}
	n, err := s.store.UserCount(r.Context())
	return n == 0, err
}

func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	open, err := s.registrationOpen(r)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"registrationOpen": open, "version": s.version})
}

type credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type sessionResponse struct {
	Token string     `json:"token"`
	User  store.User `json:"user"`
}

// rateLimited applies the login/registration limiter, answering 429 when exhausted.
func (s *Server) rateLimited(w http.ResponseWriter, r *http.Request) bool {
	ok, wait := s.limiter.Allow(s.clientIP(r), s.now())
	if ok {
		return false
	}
	w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(wait.Seconds()))))
	writeError(w, http.StatusTooManyRequests, codeRateLimited, "Too many attempts. Try again shortly.")
	return true
}

func (s *Server) startSession(w http.ResponseWriter, r *http.Request, user store.User, status int) {
	token, hash := auth.NewToken()
	if err := s.store.CreateSession(r.Context(), hash, user.ID, r.UserAgent(), s.now()); err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, status, sessionResponse{Token: token, User: user})
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	if s.rateLimited(w, r) {
		return
	}
	var c credentials
	if !decodeJSON(w, r, &c) {
		return
	}
	c.Username = strings.ToLower(strings.TrimSpace(c.Username))
	if err := ValidateCredentials(c.Username, c.Password); err != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, err.Error())
		return
	}
	hash, err := auth.HashPassword(c.Password)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	// Without ALLOW_REGISTRATION only the very first account can be created here (bootstrap).
	user, err := s.store.CreateUser(r.Context(), c.Username, hash, !s.cfg.AllowRegistration, s.now())
	switch {
	case errors.Is(err, store.ErrRegistrationClosed):
		writeError(w, http.StatusForbidden, codeRegistrationClosed, "Registration is closed on this server")
		return
	case errors.Is(err, store.ErrUsernameTaken):
		writeError(w, http.StatusConflict, codeUsernameTaken, "That username is taken")
		return
	case err != nil:
		s.internalError(w, r, err)
		return
	}
	s.log.Info("user registered", "user", user.ID)
	s.startSession(w, r, user, http.StatusCreated)
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if s.rateLimited(w, r) {
		return
	}
	var c credentials
	if !decodeJSON(w, r, &c) {
		return
	}
	user, hash, err := s.store.UserByUsername(r.Context(), strings.ToLower(strings.TrimSpace(c.Username)))
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		s.internalError(w, r, err)
		return
	}
	// Runs bcrypt even for unknown users so response time doesn't reveal which usernames exist.
	if !auth.CheckPassword(hash, c.Password) {
		writeError(w, http.StatusUnauthorized, codeUnauthorized, "Wrong username or password")
		return
	}
	s.startSession(w, r, user, http.StatusOK)
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	token, _ := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if err := s.store.DeleteSession(r.Context(), auth.HashToken(token)); err != nil {
		s.internalError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"user": userFrom(r.Context())})
}

type syncRequest struct {
	DBID    string       `json:"dbId,omitempty"`
	Cursor  int64        `json:"cursor"`
	Changes []store.Card `json:"changes"`
}

type syncResponse struct {
	DBID    string       `json:"dbId"`
	Cursor  int64        `json:"cursor"`
	Changes []store.Card `json:"changes"`
}

func (s *Server) handleSync(w http.ResponseWriter, r *http.Request) {
	var req syncRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Cursor < 0 || len(req.Changes) > maxSyncChanges {
		writeError(w, http.StatusBadRequest, codeBadRequest, fmt.Sprintf("cursor must be ≥ 0 and at most %d changes per request", maxSyncChanges))
		return
	}
	for _, c := range req.Changes {
		if err := validateCard(c); err != nil {
			writeError(w, http.StatusBadRequest, codeBadRequest, err.Error())
			return
		}
	}
	// A different database (restored backup, fresh volume) can't honour a cursor from the old one.
	if req.DBID != "" && req.DBID != s.store.DBID() {
		writeError(w, http.StatusConflict, codeCursorReset, "Server database changed; sync again from cursor 0")
		return
	}
	res, err := s.store.Sync(r.Context(), userFrom(r.Context()).ID, req.Cursor, req.Changes)
	if errors.Is(err, store.ErrCursorAhead) {
		writeError(w, http.StatusConflict, codeCursorReset, "Server is behind this device; sync again from cursor 0")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, syncResponse{DBID: s.store.DBID(), Cursor: res.Cursor, Changes: res.Changes})
}

func (s *Server) handleExport(w http.ResponseWriter, r *http.Request) {
	cards, err := s.store.ActiveCards(r.Context(), userFrom(r.Context()).ID)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	w.Header().Set("Content-Disposition", `attachment; filename="unloyalty-export.json"`)
	writeJSON(w, http.StatusOK, map[string]any{
		"app": "unloyalty", "version": 1, "exportedAt": store.FormatTime(s.now()), "cards": cards,
	})
}
