package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

type User struct {
	ID       string `json:"id"`
	Username string `json:"username"`
}

// CreateUser adds an account. With firstOnly, it fails with ErrRegistrationClosed unless no users exist yet;
// the check and insert share a transaction so two racing "first" registrations can't both win.
func (s *Store) CreateUser(ctx context.Context, username, passwordHash string, firstOnly bool, now time.Time) (User, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return User{}, err
	}
	defer tx.Rollback()
	if firstOnly {
		var n int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&n); err != nil {
			return User{}, err
		}
		if n > 0 {
			return User{}, ErrRegistrationClosed
		}
	}
	id, err := uuid.NewV7()
	if err != nil {
		return User{}, err
	}
	u := User{ID: id.String(), Username: username}
	_, err = tx.ExecContext(ctx, `INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)`,
		u.ID, u.Username, passwordHash, FormatTime(now))
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return User{}, ErrUsernameTaken
		}
		return User{}, err
	}
	return u, tx.Commit()
}

func (s *Store) UserCount(ctx context.Context) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}

// UserByUsername returns the user and their password hash (username match is case-insensitive).
func (s *Store) UserByUsername(ctx context.Context, username string) (User, string, error) {
	var u User
	var hash string
	err := s.db.QueryRowContext(ctx, `SELECT id, username, password_hash FROM users WHERE username = ?`, username).Scan(&u.ID, &u.Username, &hash)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, "", ErrNotFound
	}
	return u, hash, err
}

func (s *Store) CreateSession(ctx context.Context, tokenHash []byte, userID, userAgent string, now time.Time) error {
	t := FormatTime(now)
	_, err := s.db.ExecContext(ctx, `INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?)`,
		tokenHash, userID, t, t, userAgent)
	return err
}

// sessionTouchInterval bounds writes: last_seen_at moves at most this often per session.
const sessionTouchInterval = time.Hour

// SessionUser resolves a session token hash to its user. Sessions expire `ttl` after they were last seen
// (sliding); an expired session is deleted and reported as ErrNotFound.
func (s *Store) SessionUser(ctx context.Context, tokenHash []byte, now time.Time, ttl time.Duration) (User, error) {
	var u User
	var lastSeen string
	err := s.db.QueryRowContext(ctx, `
		SELECT u.id, u.username, s.last_seen_at FROM sessions s JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = ?`, tokenHash).Scan(&u.ID, &u.Username, &lastSeen)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if err != nil {
		return User{}, err
	}
	seen, err := time.Parse(TimeFormat, lastSeen)
	if err != nil {
		return User{}, err
	}
	if now.Sub(seen) > ttl {
		_ = s.DeleteSession(ctx, tokenHash)
		return User{}, ErrNotFound
	}
	if now.Sub(seen) > sessionTouchInterval {
		if _, err := s.db.ExecContext(ctx, `UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?`, FormatTime(now), tokenHash); err != nil {
			return User{}, err
		}
	}
	return u, nil
}

func (s *Store) DeleteSession(ctx context.Context, tokenHash []byte) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE token_hash = ?`, tokenHash)
	return err
}

// PurgeExpiredSessions removes sessions not seen within ttl.
func (s *Store) PurgeExpiredSessions(ctx context.Context, now time.Time, ttl time.Duration) (int64, error) {
	res, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE last_seen_at < ?`, FormatTime(now.Add(-ttl)))
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}
