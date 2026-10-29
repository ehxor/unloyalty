// Package config reads server settings from environment variables.
package config

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Port              int
	DataDir           string
	AllowRegistration bool
	SessionTTL        time.Duration
	TrustProxyHeaders bool
}

// Load reads configuration via getenv (os.Getenv in production) and applies defaults.
func Load(getenv func(string) string) (Config, error) {
	cfg := Config{Port: 8080, DataDir: "/data", SessionTTL: 90 * 24 * time.Hour}
	var err error
	if v := getenv("PORT"); v != "" {
		if cfg.Port, err = strconv.Atoi(v); err != nil || cfg.Port < 1 || cfg.Port > 65535 {
			return cfg, fmt.Errorf("PORT: invalid port %q", v)
		}
	}
	if v := getenv("DATA_DIR"); v != "" {
		cfg.DataDir = v
	}
	if cfg.AllowRegistration, err = parseBool("ALLOW_REGISTRATION", getenv("ALLOW_REGISTRATION")); err != nil {
		return cfg, err
	}
	if cfg.TrustProxyHeaders, err = parseBool("TRUST_PROXY_HEADERS", getenv("TRUST_PROXY_HEADERS")); err != nil {
		return cfg, err
	}
	if v := getenv("SESSION_TTL"); v != "" {
		if cfg.SessionTTL, err = ParseDuration(v); err != nil || cfg.SessionTTL <= 0 {
			return cfg, fmt.Errorf("SESSION_TTL: invalid duration %q (use e.g. 90d, 12h)", v)
		}
	}
	return cfg, nil
}

func parseBool(name, v string) (bool, error) {
	if v == "" {
		return false, nil
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return false, fmt.Errorf("%s: expected true or false, got %q", name, v)
	}
	return b, nil
}

// ParseDuration accepts Go durations plus a whole-day suffix: "90d", "36h", "1d12h".
func ParseDuration(s string) (time.Duration, error) {
	days, rest, found := strings.Cut(s, "d")
	if !found {
		return time.ParseDuration(s)
	}
	n, err := strconv.Atoi(days)
	if err != nil || n < 0 {
		return 0, fmt.Errorf("invalid day count in %q", s)
	}
	d := time.Duration(n) * 24 * time.Hour
	if rest == "" {
		return d, nil
	}
	extra, err := time.ParseDuration(rest)
	if err != nil {
		return 0, err
	}
	return d + extra, nil
}
