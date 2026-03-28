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

For patch, e.g., from 0.0.8 to 0.0.9

```bash
npm version patch -m "Release notes"
git push --follow-tags
```

For minor, e.g., from 0.0.8 to 0.1.0

```bash
npm version minor -m "Release notes"
git push --follow-tags
```

Type `\` and then Enter to type new line in message.

### Library packages

Library packages (`@gaunt-sloth/core`, `@gaunt-sloth/tools`, `@gaunt-sloth/api`,
`@gaunt-sloth/review`) are versioned independently. `npm version` does not work
well in workspaces for scoped packages, so bump versions manually:

1. Edit the `"version"` field in each package's `package.json`
2. Update cross-references (e.g. `@gaunt-sloth/core` dependency in review)
3. Commit and tag each package:

```bash
git tag "@gaunt-sloth/core@0.0.2"
git tag "@gaunt-sloth/review@0.0.2"
git push --follow-tags
```

Tags follow the `@scope/name@version` convention (same as npm).

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

```bash
npm login
npm publish
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

Publish all library packages (first time requires `--access public` for scoped packages):

```bash
npm publish --access public -w @gaunt-sloth/core -w @gaunt-sloth/tools -w @gaunt-sloth/api -w @gaunt-sloth/review
```

Subsequent publishes do not need `--access public`.

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
