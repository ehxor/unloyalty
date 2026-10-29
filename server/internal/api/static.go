package api

import (
	"bytes"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
)

func init() {
	// Not in Go's built-in table; browsers want the right type for the PWA manifest.
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
}

// staticHandler serves the built PWA. Hashed /assets/* are cached forever; everything else is revalidated
// so a new deploy (index.html, sw.js, manifest) is picked up. Unknown app paths get index.html (client routing);
// unknown files get 404 so a missing script never comes back as HTML.
func (s *Server) staticHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if name == "" {
			name = "index.html"
		}
		if info, err := fs.Stat(s.web, name); err == nil && !info.IsDir() {
			if strings.HasPrefix(name, "assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			} else {
				w.Header().Set("Cache-Control", "no-cache")
			}
			serveFile(w, r, s.web, name)
			return
		}
		if strings.HasPrefix(name, "assets/") || strings.Contains(path.Base(name), ".") {
			http.NotFound(w, r)
			return
		}
		if _, err := fs.Stat(s.web, "index.html"); err != nil {
			http.Error(w, "web app not built into this binary", http.StatusNotFound)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		serveFile(w, r, s.web, "index.html")
	})
}

// serveFile writes a file from fsys under an already-resolved name (http.ServeFileFS would redirect
// ".../index.html" and SPA paths).
func serveFile(w http.ResponseWriter, r *http.Request, fsys fs.FS, name string) {
	f, err := fsys.Open(name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}
	content, ok := f.(io.ReadSeeker)
	if !ok {
		b, err := io.ReadAll(f)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		content = bytes.NewReader(b)
	}
	if ct := mime.TypeByExtension(path.Ext(name)); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	http.ServeContent(w, r, name, info.ModTime(), content)
}
