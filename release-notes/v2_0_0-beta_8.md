# v2.0.0-beta.8

- A turn the provider rejects for size is now compacted and retried on every surface. The TUI and
  the editor integrations used to report the overflow and end the turn where the plain readline
  surface folded the older messages and carried on; they now do the same, and say so where it
  happened — the TUI as a notice inside the turn, the editors as a line in the conversation.
  Nothing already shown is undone: the tool calls before the notice ran, and the answer after it is
  the same turn continued with the summary standing in for the older messages. A second overflow
  still ends the turn and says why. See
  [Interactive sessions → When a turn overflows anyway](../docs/guides/interactive-sessions.md#when-a-turn-overflows-anyway).
