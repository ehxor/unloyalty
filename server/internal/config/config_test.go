package config

import (
	"testing"
	"time"
)

func TestParseDuration(t *testing.T) {
	for in, want := range map[string]time.Duration{
		"90d":   90 * 24 * time.Hour,
		"1d12h": 36 * time.Hour,
		"36h":   36 * time.Hour,
		"0d":    0,
	} {
		got, err := ParseDuration(in)
		if err != nil || got != want {
			t.Errorf("ParseDuration(%q) = %v, %v; want %v", in, got, err, want)
		}
	}
	for _, in := range []string{"d", "-1d", "1x", "1d2", ""} {
		if _, err := ParseDuration(in); err == nil {
			t.Errorf("ParseDuration(%q) accepted", in)
		}
	}
}

func TestLoadDefaultsAndErrors(t *testing.T) {
	cfg, err := Load(func(string) string { return "" })
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Port != 8080 || cfg.DataDir != "/data" || cfg.SessionTTL != 90*24*time.Hour || cfg.AllowRegistration || cfg.TrustProxyHeaders {
		t.Fatalf("defaults: %+v", cfg)
	}
	for key, value := range map[string]string{"PORT": "0", "SESSION_TTL": "0d", "ALLOW_REGISTRATION": "yes please"} {
		env := map[string]string{key: value}
		if _, err := Load(func(k string) string { return env[k] }); err == nil {
			t.Errorf("%s=%q accepted", key, value)
		}
	}
}
