package api

import (
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ehxor/unloyalty/server/internal/store"
)

// Mirrors web/src/formats/formats.ts FORMAT_IDS. The server checks structure and bounds;
// barcode-specific rules (check digits etc.) are enforced by the client that created the card.
var knownFormats = map[string]bool{
	"code128": true, "gs1_128": true, "code39": true, "code39ext": true, "code93": true,
	"ean13": true, "ean8": true, "upca": true, "upce": true, "itf": true, "codabar": true,
	"qr": true, "gs1_qr": true, "pdf417": true, "aztec": true, "datamatrix": true, "gs1_datamatrix": true,
}

const (
	nameMax  = 100 // web/src/db/cards.ts NAME_MAX
	notesMax = 1000
	valueMax = 2000
)

var (
	uuidRE      = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	colorRE     = regexp.MustCompile(`^#[0-9a-f]{6}$`)
	timestampRE = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`)
)

func validTimestamp(s string) bool {
	if !timestampRE.MatchString(s) {
		return false
	}
	_, err := time.Parse(store.TimeFormat, s)
	return err == nil
}

func validateCard(c store.Card) error {
	switch {
	case !uuidRE.MatchString(c.ID):
		return fmt.Errorf("invalid id")
	case c.Name == "" || c.Name != strings.TrimSpace(c.Name) || utf8.RuneCountInString(c.Name) > nameMax:
		return fmt.Errorf("card %s: invalid name", c.ID)
	case !knownFormats[c.Format]:
		return fmt.Errorf("card %s: unknown format %q", c.ID, c.Format)
	case c.Value == "" || utf8.RuneCountInString(c.Value) > valueMax || !utf8.ValidString(c.Value):
		return fmt.Errorf("card %s: invalid value", c.ID)
	case c.Color != nil && !colorRE.MatchString(*c.Color):
		return fmt.Errorf("card %s: invalid color", c.ID)
	case c.Notes != nil && (*c.Notes == "" || utf8.RuneCountInString(*c.Notes) > notesMax):
		return fmt.Errorf("card %s: invalid notes", c.ID)
	case math.IsNaN(c.SortOrder) || math.IsInf(c.SortOrder, 0):
		return fmt.Errorf("card %s: invalid sortOrder", c.ID)
	case !validTimestamp(c.CreatedAt) || !validTimestamp(c.UpdatedAt):
		return fmt.Errorf("card %s: invalid timestamps", c.ID)
	case c.LastUsedAt != nil && !validTimestamp(*c.LastUsedAt):
		return fmt.Errorf("card %s: invalid lastUsedAt", c.ID)
	}
	return nil
}

var usernameRE = regexp.MustCompile(`^[a-z0-9._-]{3,64}$`)

func ValidateCredentials(username, password string) error {
	if !usernameRE.MatchString(username) {
		return fmt.Errorf("username must be 3–64 characters: letters, digits, dot, dash or underscore")
	}
	// bcrypt only uses the first 72 bytes; refuse longer rather than silently truncating.
	if len(password) < 8 || len(password) > 72 {
		return fmt.Errorf("password must be 8–72 bytes long")
	}
	return nil
}
