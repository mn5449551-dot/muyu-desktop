# Release Guide

This project publishes desktop artifacts for:

- macOS: `dmg`
- Windows: `zip` (portable)

iOS packaging is out of scope for this Electron repository.

## Versioning and Tag

Use semver tags:

- `v0.1.0`
- `v0.1.1`
- `v0.2.0`

The GitHub Actions workflow triggers on `v*` tags.

## Pre-release Checklist

Run locally before tagging:

```bash
npm ci
npm run rebuild-native
npm run release:check
```

If you want to verify packagers manually:

```bash
npm run build:mac
# On Windows runner/machine:
npm run build:win
```

## Release Flow (Automated)

1. Commit and push all release-ready changes.
2. Create and push tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

3. GitHub Actions workflow `.github/workflows/release.yml` runs:
   - `build-mac`: builds `dist-electron/*.dmg`
   - `build-win`: builds `dist-electron/*.zip`
4. Workflow uploads both artifacts to GitHub Release under that tag.

## Artifacts

Expected release assets:

- `*.dmg` for macOS
- `*.zip` for Windows portable distribution

## Rollback

If a release is broken:

1. Delete the GitHub Release for the tag.
2. Delete the remote tag:

```bash
git push origin :refs/tags/v0.1.0
```

3. Fix issues on main branch.
4. Re-tag with a new version (recommended) or recreate the old tag if policy allows.

## Notes About Signing

Current flow does not include code-signing or notarization.

- macOS users may see Gatekeeper warnings.
- Windows users may see SmartScreen warnings.

For production-grade distribution, add platform signing credentials and notarization in CI secrets.
