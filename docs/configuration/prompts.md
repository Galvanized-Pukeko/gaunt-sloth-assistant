# Prompt Files (prompts)

Gaunt Sloth composes its system prompt from seven segments, each backed by a prompt file. The
`prompts` config object retargets, disables, or composes any segment — most commonly to feed the
agent your project's coding guidelines.

## Lead use case: give the agent your project guidelines

Goal: your coding rules already live in an `AGENTS.md` at the repo root, and you want every `gth`
run to load them as guidelines instead of maintaining a second copy in `.gsloth.guidelines.md`.

Point the `guidelines` segment at that file in `.gsloth.config.json`:

```json
{
  "prompts": {
    "guidelines": "AGENTS.md"
  }
}
```

The string `"AGENTS.md"` is shorthand for `{ "path": "AGENTS.md" }`: the file **replaces** the
built-in guidelines segment, so `AGENTS.md` is now read into the system prompt on every command.
No flag, no per-run pasting. To keep both your `.gsloth.guidelines.md` and an appended `AGENTS.md`,
use the object form with `"mode": "append"` (below).

For the coding-workflow walkthrough of this — including the default-file path that needs no config
at all — see the [Code with your own project rules](../guides/code-with-your-rules.md) guide. This
page is the full segment reference it points to.

## The seven segments

Each segment is backed by a prompt file with a well-known default name:

| Segment | Default file | Used |
| --- | --- | --- |
| `backstory` | `.gsloth.backstory.md` | every command (identity) |
| `guidelines` | `.gsloth.guidelines.md` | every command (project guidelines) |
| `system` | `.gsloth.system.md` | every command (appended last) |
| `chat` | `.gsloth.chat.md` | `chat` mode prompt |
| `code` | `.gsloth.code.md` | `code` mode prompt |
| `exec` | `.gsloth.exec.md` | `exec` mode prompt |
| `review` | `.gsloth.review.md` | `review` / `pr` instructions |

With no config, each segment reads its default-named file from the config dir
(`.gsloth/.gsloth-settings/`, honouring [identity profiles](./profiles.md)) or the project root,
falling back to the bundled default shipped with the installation.

`gth init` scaffolds only `.gsloth.config.json` — no template prompt files are planted; the bundled
defaults apply until you add your own files or `prompts` config.

## The `prompts` object

The `prompts` config object retargets, disables, or extends any segment. Each segment accepts a
string (a file path — the common case) or an object `{ path?, enabled?, mode? }`:

```json
{
  "prompts": {
    "guidelines": "AGENTS.md",
    "review": { "path": "docs/review-checklist.md", "mode": "append" },
    "backstory": { "enabled": false }
  }
}
```

- A **string** is shorthand for `{ "path": … }`: the file replaces the segment's built-in content.
  Pointing `guidelines` at an existing `AGENTS.md` is the typical use.
- **`path`** resolves like every prompt file: the config dir (and identity profile) first, then
  relative to the project root.
- **`enabled: false`** drops the segment entirely — even its bundled default. Use it to run without
  a segment rather than shadowing it with an empty file.
- **`mode`** controls composition when `path` is set: `"replace"` (default) substitutes the
  built-in segment content; `"append"` keeps the built-in content (your default-named file, or the
  bundled default) and appends the file after it — use it to add project rules on top of the stock
  review prompt instead of rewriting it.

## Path-scoped prompts

`prompts.paths` attaches extra prompt content that applies only when the diff under review touches
particular paths. Without it a review of a two-file change in one package is composed against the
whole repository's guidelines, and the rules for every other package are in the prompt too.

Only `gth review` and `gth pr` honour it — they are the commands that have a diff to select from.
Any other command with `prompts.paths` in its config warns and runs on the root segments alone:

```text
Config sets prompts.paths, but the ask command cannot use it: path-scoped prompts are selected
from the paths in a diff, and only review and pr have one. The root prompt segments still apply.
```

### A worked configuration

Two packages with their own rules, on top of a repository-wide `AGENTS.md`:

```json
{
  "prompts": {
    "guidelines": "AGENTS.md",
    "paths": [
      {
        "name": "api",
        "match": ["packages/api/**"],
        "guidelines": ".gsloth/guidelines/api.md"
      },
      {
        "name": "web",
        "match": ["packages/web/**", "!packages/web/**/dist/**"],
        "guidelines": ".gsloth/guidelines/web.md",
        "review": ".gsloth/guidelines/review-web.md"
      }
    ]
  }
}
```

Review a diff that touches both packages:

```bash
gth review --content-source git
```

The `guidelines` segment the model receives is `AGENTS.md`, then:

```text
## Module guidelines
The diff under review touches these modules. Each block applies ONLY to files under its paths.

### api — packages/api/**
<contents of .gsloth/guidelines/api.md>

### web — packages/web/**, !packages/web/**/dist/**
<contents of .gsloth/guidelines/web.md>
```

The `web` entry's `review` file is composed the same way under `## Module review instructions`, into
the `review` segment. The remaining five segments use `## Module <segment> prompt`. An entry that
carries no file for a segment contributes nothing to it, and a segment no entry carries gets no
heading at all.

Each entry takes:

- **`name`** — required, non-empty. It is the `###` heading above the entry's block, and the name in
  the run's report line.
- **`match`** — required, at least one non-empty pattern. A leading `!` excludes.
- **any of the seven segment names** — optional, each a plain string path, resolved exactly like the
  `path` of a root segment above.

An entry is selected when one of its patterns matches a changed path and no `!` pattern of the same
entry matches *that same path*. Exclusion is per path, not per entry: `!packages/web/**/dist/**`
stops a built file pulling the `web` entry in, while a change to `packages/web/src/App.vue` in the
same diff still selects it.

### Entries always append

A scoped entry adds to the root segment and can never replace or disable it, so `mode` and `enabled`
are rejected inside an entry rather than quietly ignored:

```text
Scoped prompt entry "web" under prompts.paths does not accept "mode". A scoped entry always
APPENDS to the root segment and can neither replace nor disable it, so mode and enabled are not
accepted here; every segment in a scoped entry is a plain file path. To replace or disable a
segment, configure it at the top level of prompts.
```

Disabling a root segment and scoping the rest is a supported combination: `"guidelines": { "enabled":
false }` alongside `paths` composes the module blocks on their own, with no repository-wide
guidelines above them.

Selected entries are composed in the order they appear in `paths`, never the order their patterns
matched, so the config file fixes the sequence the model reads them in. A `paths` list in a project
config **replaces** a global one — the two lists are not concatenated.

### Pattern vocabulary

| Written | Means |
| --- | --- |
| `**` as a whole segment | zero or more path segments — the only construct that crosses `/` |
| `*` | zero or more characters within one segment |
| `?` | exactly one character within one segment |
| `{a,b}` | alternation, and it nests: `{a,{b,c}}` |
| leading `!` | the pattern excludes instead of including |

Matching is case-sensitive, and everything outside that table is a literal — including `\`, because
there is **no escape character**. A path that genuinely contains `*`, `?` or `{`, or begins with
`!`, therefore cannot be written as a pattern.

**Patterns and paths are POSIX, `/`-separated, on every platform — Windows included.** The paths
are read out of the unified diff, where git writes forward slashes whatever machine produced the
commit. So `packages\web\**` is not a Windows spelling of `packages/web/**`: with no `/` in it, it
is a single-segment pattern of literal backslashes, and it matches none of the paths a diff carries.
Nothing rejects it — the entry is valid and simply never selects, so the run reports it as an entry
that matched nothing.

`**` crosses `/` only as a whole segment. Inside a larger segment it degrades to `*` and stays
within that segment, so `packages/**.ts` matches `packages/index.ts` but not
`packages/api/index.ts`.

### What the run tells you

A misspelled pattern attaches nothing and produces a review that looks entirely ordinary, so every
outcome is reported. When at least one entry is selected, the run says which, beside the run header:

```text
Scoped prompts: api, web (2 of 2 entries, 37 changed files)
```

That line is part of the review document, so [`output.header: "none"`](./output.md#run-header-outputheader)
drops it along with the header. The warnings below are diagnostics rather than document content, and
are not silenced with it:

- the content under review is not a diff at all — `--content-source text`, or a file review:

  ```text
  No "diff --git" header was found in the content under review, so the 2 configured prompts.paths
  entries could not be selected from. Path-scoped prompts need a unified diff — check the content
  source for this run.
  ```

- the diff was read, and no entry matched any of its paths:

  ```text
  2 configured prompts.paths entries matched none of the 37 changed paths in this diff, so no
  module prompts were attached. Check the match globs against the paths the diff actually touches.
  ```

- a selected entry's file is missing or empty. That block is left out rather than composed empty,
  and the rest of the run proceeds:

  ```text
  Scoped prompt "web" points its guidelines at .gsloth/guidelines/web.md, which does not exist
  (looked for /home/you/acme-platform/.gsloth/guidelines/web.md). That module's guidelines will be
  missing from this run.
  ```

- the selected files add up to more than 65536 bytes. Nothing is ever truncated — a guideline cut
  mid-sentence is worse than a long prompt:

  ```text
  Path-scoped prompts add 70123 bytes to this run's prompt (api, web), over the 65536-byte guide.
  Nothing was truncated; consider narrowing the match globs or shortening those files.
  ```

The monorepo workflow this was built for is walked through in
[Work in a monorepo](../guides/monorepo.md).

## Turning off the bundled defaults (noDefaultPrompts)

By default, Gaunt Sloth falls back to its bundled `.gsloth.*.md` prompt files when no user-provided
files are found. Setting `noDefaultPrompts` to `true` disables this fallback, so only user-provided
prompt files are used. This applies to all `.gsloth.*.md` files including backstory, system, chat,
code, guidelines, and review instructions.

```json
{
  "noDefaultPrompts": true
}
```

To drop a **single** segment (including its bundled default), use `prompts.<segment>.enabled: false`
instead — `noDefaultPrompts` is the all-segments switch.
