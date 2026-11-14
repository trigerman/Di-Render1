# Local browser security policy

Di-Render processes figures, imported tables, SVG artwork and PNG/JPEG images
in the browser. It has no account service, upload endpoint or remote processing.
Projects and recovery records use IndexedDB; preferences use localStorage.
Save portable project backups before clearing browser storage.

`npm start` runs `scripts/serve-local.mjs`, bound to `127.0.0.1`. It accepts only
GET and HEAD requests with a matching local Host header. Requests outside
`app/dist/`, malformed paths and missing files are rejected. Errors are not
cached. The page shell revalidates; fingerprinted assets and SHA-256 artwork
filenames receive immutable cache headers.

`scripts/local-security-headers.json` contains the response headers: Content
Security Policy, nosniff, no referrer, frame denial and disabled camera,
microphone and geolocation permissions. Scripts and workers are bundled and
same-origin. The narrow inline-style attribute exception supports React/Fabric
layout; it does not permit inline scripts or arbitrary imported stylesheets.

Imported SVGs pass structural allowlisting and DOMPurify sanitization. Catalogue
artwork is loaded only from manifest-derived local paths, with size, hash and SVG
validation. PNG/JPEG imports validate their bytes and decoded dimensions. Project
and data schemas impose byte, row, cell, object and rendering limits. Browser
storage, project files and worker messages are validated as untrusted input.

Private SVG imports remain separate from the PNG/JPEG file-drop path. An internal
artwork drag resolves a known catalogue ID before any browser-supplied image file;
unknown IDs do not fall back to arbitrary files or external URLs.

The launcher is intended for a local desktop session. Keep it running while using
the app, and use the same address and port to retain access to browser documents.
