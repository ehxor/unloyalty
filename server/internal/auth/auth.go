// Package auth holds password hashing, session tokens and login rate limiting.
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"sync"

	"golang.org/x/crypto/bcrypt"
)

const bcryptCost = 12

// dummyHash is compared against when a username doesn't exist, so unknown and known users take the same time.
// Computed on first use: cost-12 bcrypt takes ~1 s on a Raspberry Pi and must not delay startup.
var dummyHash = sync.OnceValue(func() []byte {
	h, _ := bcrypt.GenerateFromPassword([]byte("unloyalty-timing-equaliser"), bcryptCost)
	return h
})

func HashPassword(password string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	return string(h), err
}

// CheckPassword reports whether password matches hash. Pass an empty hash for an unknown user.
func CheckPassword(hash, password string) bool {
	if hash == "" {
		_ = bcrypt.CompareHashAndPassword(dummyHash(), []byte(password))
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// NewToken returns a random session token for the client and the SHA-256 hash to store.
func NewToken() (token string, hash []byte) {
	var b [32]byte
	_, _ = rand.Read(b[:]) // crypto/rand.Read never fails on supported platforms
	token = base64.RawURLEncoding.EncodeToString(b[:])
	return token, HashToken(token)
}

func HashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}
