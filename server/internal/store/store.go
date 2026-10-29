// Package store owns the SQLite database: schema migrations, users, sessions and cards.
package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"embed"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrations embed.FS

var (
	ErrNotFound           = errors.New("not found")
	ErrUsernameTaken      = errors.New("username taken")
	ErrRegistrationClosed = errors.New("registration closed")
	ErrCursorAhead        = errors.New("cursor ahead of server")
)

type Store struct {
	db   *sql.DB
	dbID string
}

// TimeFormat is the canonical timestamp: UTC, millisecond precision, so string order is time order.
const TimeFormat = "2006-01-02T15:04:05.000Z"

func FormatTime(t time.Time) string { return t.UTC().Format(TimeFormat) }

// Open opens (creating if needed) the database at path and applies pending migrations.
func Open(path string) (*Store, error) {
	q := url.Values{}
	for _, p := range []string{"journal_mode(WAL)", "busy_timeout(5000)", "foreign_keys(1)", "synchronous(NORMAL)"} {
		q.Add("_pragma", p)
	}
	// Writers take the lock up front: no SQLITE_BUSY when a read transaction upgrades.
	q.Set("_txlock", "immediate")
	db, err := sql.Open("sqlite", "file:"+path+"?"+q.Encode())
	if err != nil {
		return nil, err
	}
	// One connection: SQLite has a single writer anyway, and this keeps memory flat on a Pi.
	db.SetMaxOpenConns(1)
	s := &Store{db: db}
	if err := s.migrate(context.Background()); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate %s: %w", path, err)
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

// DBID identifies this database instance; it changes if the database is replaced (e.g. restored from an old backup).
func (s *Store) DBID() string { return s.dbID }

func (s *Store) Ping(ctx context.Context) error { return s.db.PingContext(ctx) }

func (s *Store) migrate(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)`); err != nil {
		return err
	}
	names, err := fs.Glob(migrations, "migrations/*.sql")
	if err != nil {
		return err
	}
	sort.Strings(names)
	for _, name := range names {
		base := strings.TrimPrefix(name, "migrations/")
		version, err := strconv.Atoi(strings.SplitN(base, "_", 2)[0])
		if err != nil {
			return fmt.Errorf("migration %s: name must start with a number", base)
		}
		if err := s.applyMigration(ctx, version, name); err != nil {
			return fmt.Errorf("migration %s: %w", base, err)
		}
	}

	var b [16]byte
	_, _ = rand.Read(b[:])
	if _, err := s.db.ExecContext(ctx, `INSERT OR IGNORE INTO meta (key, value) VALUES ('db_id', ?), ('rev', '0')`, hex.EncodeToString(b[:])); err != nil {
		return err
	}
	return s.db.QueryRowContext(ctx, `SELECT value FROM meta WHERE key = 'db_id'`).Scan(&s.dbID)
}

func (s *Store) applyMigration(ctx context.Context, version int, name string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var applied int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM schema_migrations WHERE version = ?`, version).Scan(&applied); err != nil {
		return err
	}
	if applied > 0 {
		return nil
	}
	body, err := migrations.ReadFile(name)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, string(body)); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO schema_migrations (version) VALUES (?)`, version); err != nil {
		return err
	}
	return tx.Commit()
}
