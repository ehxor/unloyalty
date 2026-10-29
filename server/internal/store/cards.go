package store

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
)

// Card is the wire format shared with the client (WireCard in web/src/db/schema.ts).
type Card struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Format     string  `json:"format"`
	Value      string  `json:"value"`
	Color      *string `json:"color,omitempty"`
	Notes      *string `json:"notes,omitempty"`
	SortOrder  float64 `json:"sortOrder"`
	CreatedAt  string  `json:"createdAt"`
	UpdatedAt  string  `json:"updatedAt"`
	LastUsedAt *string `json:"lastUsedAt,omitempty"`
	Deleted    bool    `json:"deleted"`
}

type SyncResult struct {
	Cursor  int64
	Changes []Card
}

const cardColumns = `id, name, format, value, color, notes, sort_order, created_at, updated_at, last_used_at, deleted, server_rev`

type rowScanner interface{ Scan(dest ...any) error }

func scanCard(r rowScanner) (Card, int64, error) {
	var c Card
	var rev int64
	err := r.Scan(&c.ID, &c.Name, &c.Format, &c.Value, &c.Color, &c.Notes, &c.SortOrder, &c.CreatedAt, &c.UpdatedAt, &c.LastUsedAt, &c.Deleted, &rev)
	return c, rev, err
}

func laterOf(a, b *string) *string {
	switch {
	case a == nil:
		return b
	case b == nil:
		return a
	case *b > *a:
		return b
	default:
		return a
	}
}

/*
Sync applies a client's changes and returns what it needs to catch up, in one transaction.

  - Each incoming card wins if it's new or its updatedAt is strictly later (last-write-wins; ties keep the stored row,
    so replays are idempotent). lastUsedAt merges by max() independently and never counts as an edit.
  - Every write takes the next value of a global revision counter.
  - The result holds every card of the user with rev > cursor, plus the current winner for every submitted id
    (so a client whose write lost always learns the winner, even if it already saw that revision).

ErrCursorAhead means the client has seen revisions this database never issued: it was replaced by an older copy.
*/
func (s *Store) Sync(ctx context.Context, userID string, cursor int64, changes []Card) (SyncResult, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return SyncResult{}, err
	}
	defer tx.Rollback()

	var revText string
	if err := tx.QueryRowContext(ctx, `SELECT value FROM meta WHERE key = 'rev'`).Scan(&revText); err != nil {
		return SyncResult{}, err
	}
	rev, err := strconv.ParseInt(revText, 10, 64)
	if err != nil {
		return SyncResult{}, err
	}
	if cursor > rev {
		return SyncResult{}, ErrCursorAhead
	}
	startRev := rev

	winners := make(map[string]Card, len(changes))
	for _, in := range changes {
		stored, _, err := scanCard(tx.QueryRowContext(ctx, `SELECT `+cardColumns+` FROM cards WHERE user_id = ? AND id = ?`, userID, in.ID))
		exists := err == nil
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return SyncResult{}, err
		}
		switch {
		case !exists || in.UpdatedAt > stored.UpdatedAt:
			rev++
			in.LastUsedAt = laterOf(stored.LastUsedAt, in.LastUsedAt)
			_, err = tx.ExecContext(ctx, `
				INSERT INTO cards (user_id, `+cardColumns+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT (user_id, id) DO UPDATE SET
					name = excluded.name, format = excluded.format, value = excluded.value, color = excluded.color,
					notes = excluded.notes, sort_order = excluded.sort_order, created_at = excluded.created_at,
					updated_at = excluded.updated_at, last_used_at = excluded.last_used_at, deleted = excluded.deleted,
					server_rev = excluded.server_rev`,
				userID, in.ID, in.Name, in.Format, in.Value, in.Color, in.Notes, in.SortOrder, in.CreatedAt, in.UpdatedAt, in.LastUsedAt, in.Deleted, rev)
			winners[in.ID] = in
		case laterOf(stored.LastUsedAt, in.LastUsedAt) != stored.LastUsedAt:
			rev++
			stored.LastUsedAt = in.LastUsedAt
			_, err = tx.ExecContext(ctx, `UPDATE cards SET last_used_at = ?, server_rev = ? WHERE user_id = ? AND id = ?`, stored.LastUsedAt, rev, userID, in.ID)
			winners[in.ID] = stored
		default:
			winners[in.ID] = stored
		}
		if err != nil {
			return SyncResult{}, err
		}
	}
	if rev != startRev {
		if _, err := tx.ExecContext(ctx, `UPDATE meta SET value = ? WHERE key = 'rev'`, strconv.FormatInt(rev, 10)); err != nil {
			return SyncResult{}, err
		}
	}

	rows, err := tx.QueryContext(ctx, `SELECT `+cardColumns+` FROM cards WHERE user_id = ? AND server_rev > ? ORDER BY server_rev`, userID, cursor)
	if err != nil {
		return SyncResult{}, err
	}
	defer rows.Close()
	result := SyncResult{Cursor: rev, Changes: []Card{}}
	for rows.Next() {
		c, _, err := scanCard(rows)
		if err != nil {
			return SyncResult{}, err
		}
		result.Changes = append(result.Changes, c)
		delete(winners, c.ID)
	}
	if err := rows.Err(); err != nil {
		return SyncResult{}, err
	}
	for _, c := range winners {
		result.Changes = append(result.Changes, c)
	}
	return result, tx.Commit()
}

// ActiveCards lists a user's non-deleted cards, in wallet order.
func (s *Store) ActiveCards(ctx context.Context, userID string) ([]Card, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+cardColumns+` FROM cards WHERE user_id = ? AND deleted = 0 ORDER BY sort_order`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cards := []Card{}
	for rows.Next() {
		c, _, err := scanCard(rows)
		if err != nil {
			return nil, err
		}
		cards = append(cards, c)
	}
	return cards, rows.Err()
}
