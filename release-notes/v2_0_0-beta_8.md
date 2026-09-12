# v2.0.0-beta.8

- A turn the provider rejects for being too large is now folded and retried on every surface. The
  TUI, both editor integrations and the AG-UI server used to report the overflow and end the turn,
  where the plain readline surface compacted the older messages and carried on. Nothing already
  shown is undone, and each surface says where the fold happened — a notice inside the turn in the
  TUI, a line in the conversation for the editors, a `context_compacted` event for an AG-UI client.
  A second overflow in the same turn still ends it and says why. See
  [Interactive sessions → When a turn overflows anyway](../docs/guides/interactive-sessions.md#when-a-turn-overflows-anyway).
- Gemini overflows reach that seam at all now. On both `google-genai` and `vertexai` an oversized
  request arrived as an unclassified bad request, so the run ended instead of compacting.
- `toolOutputPreviewLines` sets how many lines of a tool's output are previewed under its summary
  row, on the TUI and the plain surface alike; `0` leaves the one-line summary and nothing else. A
  `previewLines` entry on a single tool under `builtInTools` outranks it, so the noisiest tool can be
  collapsed while the rest keep the default of ten. It changes what you see, never what the model
  receives. See [Tool output preview depth](../docs/configuration/output.md#tool-output-preview-depth-tooloutputpreviewlines).
- A configuration error in an entry that can take more than one shape now names the entry and the
  problem, instead of reporting the whole key as invalid.
- A filename in a provider's rejection can no longer change how that rejection is read. An attached
  file whose name happened to contain a word the classifier matched on could turn a permanent refusal
  into advice to retry.

## Potentially breaking

- **`binaryFormats` accepts `image`, `file` and `audio` only.** `video` and `binary` validated but
  could never reach a model, so a config naming either failed later, at the provider, with a message
  about a block type rather than about your file. Remove a `video` entry; retype a `binary` entry as
  `file` rather than merging its extensions into an existing one, which would silently drop that
  entry's own `maxSize` and `mimeTypes`. See
  [MIGRATION → section M](../docs/MIGRATION.md#m-binaryformats-accepts-image-file-and-audio-only-hard).
