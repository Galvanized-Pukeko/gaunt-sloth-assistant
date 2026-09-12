/**
 * @module plainToolIndication
 * TUI-C30 — compact tool-call indication for the PLAIN surface (`--no-tui` readline sessions,
 * piped/single-shot `ask`/`exec`/`review`/`pr`). The Ink TUI renders tool calls from the typed
 * event stream; the plain surface streams strings, so until now a tool call only surfaced
 * through the tools' own transient notices (`📁 Reading file: …`, `🔧 Executing …` + raw child
 * output via the tool-output channel's default sink). This module watches the SAME LangGraph
 * message stream the string path already iterates and, when each `ToolMessage` lands, prints
 * one compact indication built from the shared {@link toolDisplay} registry:
 *
 *     ✓ 📁 read_file(path=README.md)
 *         # Readme            ← up to the canonical 10 preview lines, dim
 *         … (+42 more lines)
 *
 * Stream discipline (matches how the plain surface prints tool activity today): the block is
 * emitted at INFO level through `displayToolIndication` — same stdout channel, same
 * `consoleLevel` gate and session-log treatment as the existing tool notices — so scripted
 * consumers that already silence INFO chatter silence this too. Colour is used exactly when the
 * resolved `useColour` (the CFG-30 ladder in `config/colour.ts`) says so — TUI-C35 removed the
 * local `&& stdout.isTTY` narrowing this module used to apply on top, which was redundant against
 * the ladder's own rung-4 TTY auto-detection everywhere except `FORCE_COLOR` on a pipe, the one
 * case that variable exists to serve. An ordinary piped run is therefore still clean monochrome
 * (DL-7) — rung 4 decides that — with diff lines readable via their `+`/`-` prefixes.
 *
 * Live-output dedupe: shell-shaped results (`<COMMAND_OUTPUT>`) belong to tools whose child
 * output ALREADY streamed raw via the channel's default sink, so those render with
 * `liveOutputAlreadyShown` and show only the closing status line — never a repeat of output
 * the user just watched.
 */
import { AIMessage, AIMessageChunk, ToolMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import {
  buildToolPreviewLines,
  getToolGlyph,
  isShellShapedResult,
  renderToolLineAnsi,
  summariseToolCallWithResult,
  toolStatusDisplay,
} from '#src/core/toolDisplay.js';
import { displayToolIndication } from '#src/utils/consoleUtils.js';
import { getUseColour } from '#src/utils/systemUtils.js';

const INDENT = '    ';

/** One tracked (possibly still-streaming) tool call. */
interface TrackedToolCall {
  id?: string;
  name: string;
  argsText: string;
}

export interface PlainToolIndicationObserver {
  /** Feed every streamed message/chunk (the string path's existing loop) through this. */
  observe(chunk: unknown): void;
}

/**
 * Create the observer.
 *
 * **Its state lives for a TURN, not for a stream, and the caller is what decides that.**
 * `GthAbstractAgent` builds one on the first `streamFromInput` of a turn and reuses it for every
 * later stream of the same turn, discarding it when the next turn opens or `/clear` lands. This
 * is [[TUI-C106]]: an approval-gated call is announced in the stream that suspends at the gate and
 * answered in the stream that resumes, so a per-stream observer met the `ToolMessage` having never
 * seen its producer, threw away arguments it had correctly accumulated, and rendered `name()` —
 * issue #445. Nothing in this module changed to fix that; only how long it is kept.
 *
 * tool_call deltas are accumulated from `tool_call_chunks` (keyed by the provider's chunk
 * `index`, which restarts per LLM round — the map is closed into the round's tracking whenever a
 * `ToolMessage` arrives, mirroring `processEventStream`'s reset-per-round). Deliberately does
 * NOT `concat()` whole `AIMessageChunk`s: only the tool-call slices are needed, which also
 * sidesteps the TUI-C29 `__raw_response` aggregation-growth trap entirely.
 *
 * `emit` is injectable for tests; production uses the INFO-level `displayToolIndication`.
 */
export function createPlainToolIndication(
  emit: (text: string) => void = displayToolIndication,
  /**
   * [[TUI-C69]] §5.4 — **was this call refused back to the agent as a negotiation round?** Asked
   * per tool-call id at the moment the result is rendered, never earlier: the gate decides while
   * this stream is being drained, so a snapshot taken when the observer was built would always
   * say no.
   *
   * Defaults to *"nothing is a clarification"*, which is what a surface with no gate behind it
   * (and every existing caller) means.
   */
  isRaterClarification: (toolCallId: string) => boolean = () => false
): PlainToolIndicationObserver {
  /** Streaming tool-call deltas for the CURRENT round, keyed by tool_call_chunk index. */
  const streaming = new Map<number, TrackedToolCall>();
  /** Completed calls awaiting their ToolMessage, keyed by tool call id. */
  const byId = new Map<string, TrackedToolCall>();
  /**
   * [[TUI-C106]] — every call tracked in the CURRENT round, in arrival order, that no `ToolMessage`
   * has claimed yet. The by-id map above is the authoritative match and stays so; this is the
   * fallback for the case that produced the node — **a result whose `tool_call_id` the observer
   * never saw associated with any arguments.**
   *
   * That happens in more ways than a missing id. A provider may stream no tool-call id at all (the
   * deltas carry `name`/`args` only); a provider whose wire format has no ids may have one MINTED
   * for it by its LangChain integration, in which case nothing guarantees the id on the streamed
   * chunk is the id the graph later dispatches and puts on the `ToolMessage`; and two calls sharing
   * a chunk `index` in one round collapse into a single entry keyed under whichever id arrived
   * last. In all three the arguments were observed — they are simply filed under the wrong key, or
   * under none — and an exact-id lookup alone throws them away and renders `name()`.
   *
   * **Scoped to the round, and that is load-bearing.** Matching is by tool NAME, which cannot
   * mis-fire the way an id match cannot: a call left here unclaimed (one held at the approval gate,
   * one that never returned) would be eaten by the next same-name call several rounds later and
   * render a confidently wrong filename. So it is emptied when the next round starts streaming,
   * and a stale entry is simply lost — which costs a fallback label, not a correct one.
   */
  let unconsumed: TrackedToolCall[] = [];
  /** A round's results have started arriving; the next tracking event opens a new round. */
  let roundSettled = false;

  /** Start a new round if the last one has settled, discarding its unclaimed calls. */
  const beginRoundIfSettled = (): void => {
    if (!roundSettled) return;
    roundSettled = false;
    unconsumed = [];
  };

  const track = (call: TrackedToolCall): void => {
    if (call.id) byId.set(call.id, call);
    unconsumed.push(call);
  };

  const closeStreamingRound = (): void => {
    for (const call of streaming.values()) track(call);
    streaming.clear();
  };

  /** Drop a call from the round's unclaimed list once a result has spoken for it. */
  const consume = (call: TrackedToolCall): void => {
    const at = unconsumed.indexOf(call);
    if (at !== -1) unconsumed.splice(at, 1);
  };

  const renderToolMessage = (message: ToolMessage): void => {
    const id = typeof message.tool_call_id === 'string' ? message.tool_call_id : '';
    const messageName = typeof message.name === 'string' ? message.name : '';
    let tracked = id ? byId.get(id) : undefined;
    if (id) byId.delete(id);
    // [[TUI-C106]] — the id matched nothing, so fall back to this round's unclaimed calls. Matched
    // on the tool name when the result carries one; when it does not, only a round holding exactly
    // one unclaimed call is unambiguous enough to attribute.
    if (!tracked) {
      tracked = messageName
        ? unconsumed.find((call) => call.name === messageName)
        : unconsumed.length === 1
          ? unconsumed[0]
          : undefined;
    }
    if (tracked) consume(tracked);
    const name = tracked?.name || messageName || '';
    const result =
      typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
    const isError = message.status === 'error';
    // [[TUI-C69]] §5.4 — asked on the id, at render time, from the gate's own decision. Never
    // from the result text: legitimate output may begin with "Error handling…".
    const raterClarification = id ? isRaterClarification(id) : false;
    // TUI-C35 — colour is exactly what the resolved ladder says, with no local narrowing.
    // This used to AND in `stdout.isTTY`, which was redundant in every case but one: rung 4 of
    // `config/colour.ts` already auto-detects from stdout's TTY status, so an unconfigured piped
    // run is monochrome either way. The one case it changed was `FORCE_COLOR` into a pipe — which
    // it suppressed, defeating the only thing that variable is for.
    const colour = getUseColour();

    // [[TUI-C69]] §5.4 — one decision, shared with the Ink surface, about what a finished call's
    // status row says. This surface prints no `[label]` after the summary, so the WORDS are added
    // as their own tail on the clarification row: the glyph alone would leave the distinction to
    // a symbol, and §5.4's requirement has to survive a terminal with no colour at all.
    const status = toolStatusDisplay({ isError, raterClarification });
    const ansi = status.tone === 'error' ? '31' : status.tone === 'warn' ? '33' : '32';
    const statusGlyph = colour ? `\x1b[${ansi}m${status.glyph}\x1b[0m` : status.glyph;
    // [[TUI-C106]] — the result is a second source for the summary when the arguments never
    // reached this layer. A parsed args buffer always wins; this only fills a line that would
    // otherwise be `name()` and say nothing about what was read.
    const summary = summariseToolCallWithResult(name, tracked?.argsText, result);
    const summaryText = colour ? `\x1b[2m${summary}\x1b[0m` : summary;
    const note = raterClarification ? `  [${status.label}]` : '';
    const noteText = colour && note ? `\x1b[33m${note}\x1b[0m` : note;
    const head = `${statusGlyph} ${getToolGlyph(name)} ${summaryText}${noteText}`;

    const preview = buildToolPreviewLines({
      name,
      argsText: tracked?.argsText,
      result,
      isError,
      // Shell-shaped results stream their child output live through the channel's default
      // sink on this surface — suppress the duplicated body, keep the status tail. TUI-C32
      // residual c: gate on the tool NAME + shape (not shape alone), so a non-shell tool whose
      // result merely quotes `<COMMAND_OUTPUT>` keeps its preview body instead of being suppressed.
      liveOutputAlreadyShown: isShellShapedResult(name, result),
    });
    const body = preview.map((line) => INDENT + renderToolLineAnsi(line, colour));
    // Leading newline mirrors the historical notice framing (the model text stream may have
    // left the cursor mid-line).
    emit(['', head, ...body].join('\n'));
  };

  return {
    observe(chunk: unknown): void {
      // Order matters: AIMessageChunk extends AIMessage, so test the chunk shape first
      // (mirrors processEventStream).
      if (AIMessageChunk.isInstance(chunk as BaseMessage)) {
        // TUI-C32 residual e — fail-soft, matching the ToolMessage branch: accumulating tool-call
        // deltas (`JSON.stringify(tc.args)` can throw on an unserialisable arg, e.g. a BigInt) must
        // never break the run's stream loop. On any error we simply skip this chunk's tracking.
        try {
          const c = chunk as AIMessageChunk;
          const deltas = c.tool_call_chunks ?? [];
          if (deltas.length > 0) {
            beginRoundIfSettled();
            for (const delta of deltas) {
              const index = typeof delta.index === 'number' ? delta.index : 0;
              const entry = streaming.get(index) ?? { name: '', argsText: '' };
              if (delta.id) entry.id = delta.id;
              if (delta.name) entry.name = entry.name || delta.name;
              if (delta.args) entry.argsText += delta.args;
              streaming.set(index, entry);
            }
          } else if ((c.tool_calls ?? []).length > 0) {
            // Some providers surface COMPLETE tool_calls on a chunk instead of deltas.
            // [[TUI-C106]] — tracked whether or not the call carries an id: without one it is
            // unreachable by an exact lookup, which is exactly what the round's unclaimed list is
            // for. It still goes into the by-id map when there IS an id, so nothing changes for a
            // call whose id the result later matches.
            beginRoundIfSettled();
            for (const tc of c.tool_calls ?? []) {
              track({ id: tc.id, name: tc.name, argsText: JSON.stringify(tc.args ?? {}) });
            }
          }
        } catch {
          /* indication is best-effort; the model-facing stream is untouched */
        }
        return;
      }
      if (AIMessage.isInstance(chunk as BaseMessage)) {
        // A non-chunk AIMessage (resumed/checkpoint-replayed runs) carries final tool_calls.
        // TUI-C32 residual e — same fail-soft wrap as above/the ToolMessage branch.
        try {
          const m = chunk as AIMessage;
          const calls = m.tool_calls ?? [];
          if (calls.length > 0) beginRoundIfSettled();
          for (const tc of calls) {
            track({ id: tc.id, name: tc.name, argsText: JSON.stringify(tc.args ?? {}) });
          }
        } catch {
          /* indication is best-effort; the model-facing stream is untouched */
        }
        return;
      }
      if (chunk instanceof ToolMessage) {
        // The round is over: park any streamed calls under their ids (chunk indexes restart
        // next round), then render the arrived result. Fail-soft — rendering must never break
        // the run.
        try {
          closeStreamingRound();
          renderToolMessage(chunk);
          // [[TUI-C106]] — the round has produced a result, so the next tracking event belongs to a
          // new one. Deferred rather than done here: the round's SIBLING results are still to come,
          // and they need this round's unclaimed calls to attribute against.
          roundSettled = true;
        } catch {
          /* indication is best-effort; the model-facing stream is untouched */
        }
      }
    },
  };
}
