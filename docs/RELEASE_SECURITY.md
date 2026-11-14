# Public snapshot security review — 2026-10-11

The public local-app candidate received a focused source review, npm dependency
audits, a release-tree privacy/credential scan, provenance checks and adversarial
browser checks. No reachable application vulnerability was found in the paths
reviewed. This record is not an independent security-service attestation.

## Dependency finding addressed

The browser development lockfile contained source-map-js 1.2.1, affected by
[GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).
It is updated to the patched 1.2.2. Only that package record changes; the public
lockfile retains the complete optional-package records for other platforms.
Both lockfile audits now report zero critical, high or moderate vulnerabilities.

One low-severity package advisory remains for the vendored DOMPurify 3.4.15.
Its two reported issues require IN_PLACE sanitization; one additionally requires
node-removing afterSanitize hooks. The app uses serialized SVG strings, without
IN_PLACE or registered hooks, in `app/src/domain/assets/strictSvg.ts:360`.
Structural validation runs before sanitization and rechecks the result. The
advisory preconditions are absent from the application path. References:
[hook removal](https://github.com/advisories/GHSA-p98j-92pf-mc4p) and
[rawtext root](https://github.com/advisories/GHSA-6688-9rhm-gjv2).

## Boundaries reviewed

- Local server: loopback binding, exact local Host checks, GET/HEAD only,
  path containment, bounded path input, MIME types, no-store errors and the
  original restrictive security headers. Seven HTTP boundary checks passed.
- Catalogue SVGs: manifest-derived paths, redirect rejection, timeouts, byte
  hashes, structural sanitization and verified provenance. Internal drags resolve
  catalogue IDs before files; unknown IDs never fall back to arbitrary content.
- Local image imports: PNG/JPEG signatures, file-size and dimension limits,
  full browser decoding and metadata validation before insertion.
- Tables, projects and workers: strict schemas, cumulative budgets, source hashes,
  immutable data-source binding, bounded plot expansion and cancellation. Imports,
  storage reloads and portable projects use the public validated document model.
- Presentation and export: user labels remain text, SVG content is sanitized,
  CSV formula-leading strings are escaped, and exported raster references are
  rebuilt only from validated project media.
- Persistence and switching: transactional writes, recovery validation, stale
  result guards and staged editor changes preserve the previous valid figure.

## Publication hygiene

The tracked release tree was checked for credentials, private keys, recognizable
provider tokens, personal home paths and excluded local tooling. No such content
was detected. Required public third-party credits remain intact.

All 2,665 source artwork files and their 2,665 built copies matched the manifest's
SHA-256 filenames. Pinned Apache POI source bytes and redistributed notices were
checked in the Git index, with byte-preserving attributes for future checkouts.
The public update contains selected release files and retains the existing
public history; no private development history is imported.

See [the validation record](RELEASE_VALIDATION.md) for build digests, commands
and browser coverage. Review scope is the local browser application and its
loopback launcher; external infrastructure and native installers are excluded.
