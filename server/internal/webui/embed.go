// Package webui embeds the built PWA. The build copies web/dist here (see Makefile/Dockerfile);
// without it only .keep is embedded and the server answers non-API paths with 404.
package webui

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var files embed.FS

// FS returns the built web app rooted at dist/.
func FS() fs.FS {
	sub, err := fs.Sub(files, "dist")
	if err != nil {
		panic(err) // dist/ is always embedded (at least .keep)
	}
	return sub
}
