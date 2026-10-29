package store

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

var ctx = context.Background()

func openTemp(t *testing.T) (*Store, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "wallet.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s, path
}

func mustUser(t *testing.T, s *Store, name string) User {
	t.Helper()
	u, err := s.CreateUser(ctx, name, "hash", false, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func card(id, name, updatedAt string) Card {
	return Card{
		ID: id, Name: name, Format: "code128", Value: "V-" + name, SortOrder: 1,
		CreatedAt: "2026-01-01T00:00:00.000Z", UpdatedAt: updatedAt,
	}
}

const idA = "01900000-0000-7000-8000-000000000001"

func sync(t *testing.T, s *Store, userID string, cursor int64, changes ...Card) SyncResult {
	t.Helper()
	res, err := s.Sync(ctx, userID, cursor, changes)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func byID(cards []Card) map[string]Card {
	m := map[string]Card{}
	for _, c := range cards {
		m[c.ID] = c
	}
	return m
}

func TestOpenIsIdempotentAndKeepsDBID(t *testing.T) {
	s, path := openTemp(t)
	id := s.DBID()
	if len(id) != 32 {
		t.Fatalf("db id %q", id)
	}
	s.Close()
	again, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer again.Close()
	if again.DBID() != id {
		t.Fatalf("db id changed: %s → %s", id, again.DBID())
	}
}

func TestSyncLastWriteWins(t *testing.T) {
	s, _ := openTemp(t)
	u := mustUser(t, s, "alice")

	first := sync(t, s, u.ID, 0, card(idA, "v1", "2026-01-01T10:00:00.000Z"))
	if first.Cursor != 1 || len(first.Changes) != 1 || first.Changes[0].Name != "v1" {
		t.Fatalf("insert: %+v", first)
	}

	// A device with the latest cursor sends an older edit (clock skew). It loses, and even though the
	// winner's revision isn't newer than the cursor, the response must include it so the client can stop retrying.
	stale := sync(t, s, u.ID, first.Cursor, card(idA, "stale", "2026-01-01T09:00:00.000Z"))
	if stale.Cursor != first.Cursor {
		t.Fatalf("losing write bumped the revision: %d", stale.Cursor)
	}
	if got := byID(stale.Changes)[idA]; got.Name != "v1" {
		t.Fatalf("losing write not answered with the winner: %+v", stale.Changes)
	}

	// Equal timestamps keep the stored row (replays are idempotent).
	tie := sync(t, s, u.ID, first.Cursor, card(idA, "tie", "2026-01-01T10:00:00.000Z"))
	if byID(tie.Changes)[idA].Name != "v1" || tie.Cursor != first.Cursor {
		t.Fatalf("tie: %+v", tie)
	}

	newer := sync(t, s, u.ID, first.Cursor, card(idA, "v2", "2026-01-01T11:00:00.000Z"))
	if newer.Cursor != 2 || byID(newer.Changes)[idA].Name != "v2" {
		t.Fatalf("newer: %+v", newer)
	}
}

func TestSyncLastUsedMergesByMaxWithoutBeingAnEdit(t *testing.T) {
	s, _ := openTemp(t)
	u := mustUser(t, s, "alice")
	c := card(idA, "shop", "2026-01-01T10:00:00.000Z")
	c.LastUsedAt = new("2026-02-01T00:00:00.000Z")
	base := sync(t, s, u.ID, 0, c)

	// Same updatedAt, later lastUsedAt: only lastUsedAt changes, as a new revision other devices will pull.
	used := c
	used.Name = "ignored"
	used.LastUsedAt = new("2026-03-01T00:00:00.000Z")
	res := sync(t, s, u.ID, base.Cursor, used)
	got := byID(res.Changes)[idA]
	if res.Cursor != base.Cursor+1 || got.Name != "shop" || *got.LastUsedAt != "2026-03-01T00:00:00.000Z" {
		t.Fatalf("lastUsed-only: cursor %d, %+v", res.Cursor, got)
	}

	// A newer edit carrying an older lastUsedAt keeps the later one.
	edit := card(idA, "renamed", "2026-01-02T00:00:00.000Z")
	edit.LastUsedAt = new("2026-01-15T00:00:00.000Z")
	got = byID(sync(t, s, u.ID, res.Cursor, edit).Changes)[idA]
	if got.Name != "renamed" || *got.LastUsedAt != "2026-03-01T00:00:00.000Z" {
		t.Fatalf("edit merge: %+v", got)
	}
}

func TestSyncReturnsOnlyNewerRevisionsAndTombstones(t *testing.T) {
	s, _ := openTemp(t)
	u := mustUser(t, s, "alice")
	idB := "01900000-0000-7000-8000-000000000002"
	r1 := sync(t, s, u.ID, 0, card(idA, "a", "2026-01-01T10:00:00.000Z"), card(idB, "b", "2026-01-01T10:00:00.000Z"))
	if r1.Cursor != 2 {
		t.Fatalf("cursor %d", r1.Cursor)
	}
	del := card(idB, "b", "2026-01-01T12:00:00.000Z")
	del.Deleted = true
	sync(t, s, u.ID, r1.Cursor, del)

	// Another device that has seen r1 pulls only the tombstone.
	pull := sync(t, s, u.ID, r1.Cursor)
	if len(pull.Changes) != 1 || pull.Changes[0].ID != idB || !pull.Changes[0].Deleted {
		t.Fatalf("pull: %+v", pull.Changes)
	}
	if empty := sync(t, s, u.ID, pull.Cursor); len(empty.Changes) != 0 {
		t.Fatalf("caught-up pull returned %+v", empty.Changes)
	}
}

func TestSyncIsolatesUsers(t *testing.T) {
	s, _ := openTemp(t)
	alice := mustUser(t, s, "alice")
	bob := mustUser(t, s, "bob")
	sync(t, s, alice.ID, 0, card(idA, "alice-card", "2026-01-01T10:00:00.000Z"))

	// Bob uses the same id with a newer timestamp: he gets his own row, Alice's is untouched.
	res := sync(t, s, bob.ID, 0, card(idA, "bob-card", "2026-06-01T10:00:00.000Z"))
	if len(res.Changes) != 1 || res.Changes[0].Name != "bob-card" {
		t.Fatalf("bob sees %+v", res.Changes)
	}
	aliceCards, err := s.ActiveCards(ctx, alice.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(aliceCards) != 1 || aliceCards[0].Name != "alice-card" {
		t.Fatalf("alice's card changed: %+v", aliceCards)
	}
}

func TestSyncCursorAhead(t *testing.T) {
	s, _ := openTemp(t)
	u := mustUser(t, s, "alice")
	if _, err := s.Sync(ctx, u.ID, 5, nil); !errors.Is(err, ErrCursorAhead) {
		t.Fatalf("err = %v", err)
	}
}

func TestCreateUserFirstOnlyAndUniqueness(t *testing.T) {
	s, _ := openTemp(t)
	now := time.Now()
	if _, err := s.CreateUser(ctx, "alice", "h", true, now); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateUser(ctx, "bob", "h", true, now); !errors.Is(err, ErrRegistrationClosed) {
		t.Fatalf("second first-only user: %v", err)
	}
	if _, err := s.CreateUser(ctx, "ALICE", "h", false, now); !errors.Is(err, ErrUsernameTaken) {
		t.Fatalf("case-insensitive duplicate: %v", err)
	}
}

func TestSessionsSlideAndExpire(t *testing.T) {
	s, _ := openTemp(t)
	u := mustUser(t, s, "alice")
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	ttl := 48 * time.Hour
	token := []byte("hash")
	if err := s.CreateSession(ctx, token, u.ID, "test", t0); err != nil {
		t.Fatal(err)
	}
	// Used after 40 h: still valid, and last-seen moves forward…
	if _, err := s.SessionUser(ctx, token, t0.Add(40*time.Hour), ttl); err != nil {
		t.Fatal(err)
	}
	// …so 80 h after creation (40 h after last use) it's still alive.
	if _, err := s.SessionUser(ctx, token, t0.Add(80*time.Hour), ttl); err != nil {
		t.Fatalf("sliding expiry: %v", err)
	}
	if _, err := s.SessionUser(ctx, token, t0.Add(80*time.Hour+ttl+time.Minute), ttl); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expired session: %v", err)
	}
}
