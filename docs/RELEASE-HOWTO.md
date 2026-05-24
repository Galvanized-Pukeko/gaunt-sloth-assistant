# Release HOWTO

## Creating npm version

Good habit is to ask Gaunt Sloth to review changes before releasing them:

```bash
git --no-pager diff v0.8.3..HEAD | gth review
```

Make sure `npm config set git-tag-version true`

! Important ! The `files` block of package.json strictly controls what is actually released,
the `files` makes .npmignore ignored.

### Assistant package

The CLI `gaunt-sloth-assistant` lives in `packages/assistant` and carries its
own version (tagged `vX.Y.Z`), independent of the lock-stepped `@gaunt-sloth/*`
libraries. The repo root (`gaunt-sloth-workspace`) is `private` and is **never
published** — `npm version` / `npm publish` run at the root do not touch the
assistant.

Bump the assistant inside its workspace. npm does **not** auto-commit or tag for
workspace members, so commit and tag yourself:

```bash
npm version patch -w gaunt-sloth-assistant   # or minor / major — edits packages/assistant/package.json only
git commit -am "Release notes"
git tag -a v1.5.1 -m "Release notes"
git push --tags
```

Type `\` and then Enter to type a new line in the message.

### Library packages

Library packages (`@gaunt-sloth/core`, `@gaunt-sloth/tools`, `@gaunt-sloth/api`,
`@gaunt-sloth/review`) are versioned independently. `npm version` does not work
well in workspaces for scoped packages, so bump versions manually:

1. Edit the `"version"` field in each package's `package.json`
2. Update cross-references (e.g. `@gaunt-sloth/core` dependency in review)
3. Commit and create annotated tags for each package:

```bash
git tag -a "@gaunt-sloth/core@0.0.3" -m "Release @gaunt-sloth/core@0.0.3"
git tag -a "@gaunt-sloth/review@0.0.3" -m "Release @gaunt-sloth/review@0.0.3"
git push --follow-tags
```

Tags follow the `@scope/name@version` convention (same as npm).

Use annotated tags (`-a`) — lightweight tags are not pushed by `--follow-tags`.

## Publish Release to GitHub (assistant only)

Library packages don't need GitHub releases — they're consumed as npm
dependencies, so npm is the distribution channel. Git tags provide
version history in the repo.

Note the release version from pervious step and do

(if you have multiple accounts in gh, you may need to do `gh auth switch`)

```bash
gh release create --notes-from-tag
```

or

```bash
gh release create --notes-file pathToFile
```

Alternatively `gh release create --notes "notes"`

## Publish to NPM (optional)

This step is now automated, and GitHub action publishes any new release with Release action.

### Publishing the assistant package

The repo root is `private`, so publish from the assistant workspace — `npm publish`
at the root will refuse:

```bash
npm login
npm publish -w gaunt-sloth-assistant
```

Remember to review a list of files in the build, before confirming it.

### Publishing library packages

Preview what will be included in each package:

```bash
npm pack --dry-run -w @gaunt-sloth/core
npm pack --dry-run -w @gaunt-sloth/tools
npm pack --dry-run -w @gaunt-sloth/api
npm pack --dry-run -w @gaunt-sloth/review
```

Publish all library packages:

```bash
npm publish -w @gaunt-sloth/core -w @gaunt-sloth/tools -w @gaunt-sloth/api -w @gaunt-sloth/review
```

Note: the first ever publish of a scoped package requires `--access public`.
After that it's not needed.

### Test-deploying library packages

See [TEST-DEPLOY.md](TEST-DEPLOY.md) for how to test-deploy `@gaunt-sloth/review`
as a standalone global install before publishing.

## Viewing diff side by side

Configure KDE diff Kompare as github difftool

```bash
# Configure default git diff tool
git config --global diff.tool kompare
# Compare all changed files
git difftool v0.9.3 HEAD -d
```

Configure vimdiff

```bash
# Configure default git diff tool
git config --global diff.tool vimdiff
# Compare changed files one by one
git difftool v0.9.3 HEAD
```

## Cleaning up the mess

Delete incidental remote and local tag

```bash
git tag -d v0.3.0
git push --delete origin v0.3.0
```
