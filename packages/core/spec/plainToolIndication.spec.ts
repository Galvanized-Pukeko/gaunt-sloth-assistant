import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIMessage, AIMessageChunk, HumanMessage, ToolMessage } from '@langchain/core/messages';

const consoleUtilsMock = {
  displayToolIndication: vi.fn(),
};
vi.mock('#src/utils/consoleUtils.js', () => consoleUtilsMock);

/**
 * TUI-C35 — `stdout` is deliberately ABSENT. `plainToolIndication` no longer reads it: colour is
 * now exactly what the resolved ladder says, with no local TTY narrowing on top. Leaving a
 * `stdout.isTTY` here would let each case set a value that decides nothing, which reads as though
 * TTY-ness were still load-bearing. `env` stays — `toolDisplay` imports it.
 */
const systemUtilsMock = {
  getUseColour: vi.fn(),
  env: {} as Record<string, string | undefined>,
};
vi.mock('#src/utils/systemUtils.js', () => systemUtilsMock);

/** One streamed read_file round: two arg-delta chunks, then the ToolMessage. */
function readFileRound(): Array<AIMessageChunk | ToolMessage> {
  return [
    new AIMessageChunk({
      content: '',
      tool_call_chunks: [
        {
          name: 'read_file',
          args: '{"path":"REA',
          id: 'call-1',
          index: 0,
          type: 'tool_call_chunk',
        },
      ],
    }),
    new AIMessageChunk({
      content: '',
      tool_call_chunks: [{ args: 'DME.md"}', index: 0, type: 'tool_call_chunk' }],
    }),
    new ToolMessage({ content: 'line-1\nline-2', tool_call_id: 'call-1' }),
  ];
}

describe('plainToolIndication (TUI-C30 — the --no-tui / piped surface)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    systemUtilsMock.getUseColour.mockReturnValue(false);
    systemUtilsMock.env = {};
  });

  it('renders name(shortened-params) + a dim output preview when the ToolMessage lands', async () => {
    const { createPlainToolIndication } = await import('#src/core/plainToolIndication.js');
    const sink = vi.fn();
    const observer = createPlainToolIndication(sink);
    for (const chunk of readFileRound()) observer.observe(chunk);

    expect(sink).toHaveBeenCalledTimes(1);
    const text = sink.mock.calls[0][0] as string;
    expect(text).toContain('✓ 📁 read_file(path=README.md)'); // args re-assembled across deltas
    expect(text).toContain('\n    line-1'); // indented preview line
    expect(text).toContain('\n    line-2');
    expect(text.startsWith('\n')).toBe(true); // historical notice framing (cursor may be mid-line)
  });

  it('caps the preview at the canonical 10 lines with the overflow marker', async () => {
    const { createPlainToolIndication } = await import('#src/core/plainToolIndication.js');
    const sink = vi.fn();
    const observer = createPlainToolIndication(sink);
    const body = Array.from({ length: 14 }, (_, i) => `row-${String(i + 1).padStart(2, '0')}`);
    observer.observe(
      new AIMessageChunk({
        content: '',
        tool_call_chunks: [
          {
            name: 'read_file',
            args: '{"path":"big.txt"}',
            id: 'c1',
            index: 0,
            type: 'tool_call_chunk',
          },
        ],
      })
    );
    observer.observe(new ToolMessage({ content: body.join('\n'), tool_call_id: 'c1' }));

    const text = sink.mock.calls[0][0] as string;
    expect(text).toContain('row-01');
    expect(text).toContain('row-10');
    expect(text).not.toContain('row-11'); // beyond the canonical cap
    expect(text).toContain('… (+4 more lines)');
  });

  it('uses the ✗ glyph from the real ToolMessage.status error signal (TUI-C7)', async () => {
    const { createPlainToolIndication } = await import('#src/core/plainToolIndication.js');
    const sink = vi.fn();
    const observer = createPlainToolIndication(sink);
    observer.observe(
      new AIMessageChunk({
        content: '',
        tool_call_chunks: [
          { name: 'run_lint', args: '{}', id: 'c1', index: 0, type: 'tool_call_chunk' },
        ],
      })
    );
    observer.observe(
      new ToolMessage({ content: 'lint failed', tool_call_id: 'c1', status: 'error' })
    );
    const text = sink.mock.calls[0][0] as string;
    expect(text).toContain('✗');
    expect(text).not.toContain('✓');
  });

  /**
   * [[TUI-C69]] §5.4 — **the measured defect's twin on this surface.** A rating rejection at `auto`
   * is the gate asking the agent to narrow the command, not a tool that failed, and rendering it in
   * the ✗ vocabulary teaches the user that a working safety mechanism is a malfunction. The Ink TUI
   * had the visible instance; this surface reads the same `status === 'error'` signal and would
   * have drawn the same thing, so the fix has to land on both or it is half a fix.
   *
   * **The signal is asked for by tool-call id, from the gate's own decision** — never sniffed from
   * the result text, which legitimately begins with "Rejected." here and could as legitimately
   * begin with "Error handling…" on a real failure.
   */
  it('renders a rater clarification request in warn words, never the failed-tool ✗', async () => {
    const { createPlainToolIndication } = await import('#src/core/plainToolIndication.js');
    const sink = vi.fn();
    const observer = createPlainToolIndication(sink, (id) => id === 'c1');
    observer.observe(
      new AIMessageChunk({
        content: '',
        tool_call_chunks: [
          {
            name: 'run_shell_command',
            args: '{"command":"git clone https://example.invalid/x"}',
            id: 'c1',
            index: 0,
            type: 'tool_call_chunk',
          },
        ],
      })
    );
    observer.observe(
      new ToolMessage({
        content: 'Rejected. Clone into a directory you name.',
        tool_call_id: 'c1',
        status: 'error',
      })
    );
    const text = sink.mock.calls[0][0] as string;
    // The glyph and the WORDS both differ, so the distinction survives a terminal with no colour
    // — which is every piped run on this surface.
    expect(text).toContain('⚠');
    expect(text).toContain('[auto-rater: clarification requested]');
    expect(text).not.toContain('✗');
    // The rater's own words still render beneath the command.
    expect(text).toContain('Clone into a directory you name');
  });

  /**
   * The control: the same error status with no signal from the gate stays in the ✗ vocabulary, so
   * the new branch cannot be repainting every failed tool as a negotiation round.
   */
  it('leaves an unflagged error result in the ✗ vocabulary', async () => {
    const { createPlainToolIndication } = await import('#src/core/plainToolIndication.js');
    const sink = vi.fn();
    const observer = createPlainToolIndication(sink, () => false);
    observer.observe(
      new AIMessageChunk({
        content: '',
        tool_call_chunks: [
          { name: 'run_lint', args: '{}', id: 'c1', index: 0, type: 'tool_call_chunk' },
        ],
      })
    );
    observer.observe(
      new ToolMessage({ content: 'lint failed', tool_call_id: 'c1', status: 'error' })
    );
    const text = sink.mock.calls[0][0] as string;
    expect(text).toContain('✗');
    expect(text).not.toContain('⚠');
    expect(text).not.toContain('clarification requested');
  });

  /**
   * The monochrome guarantee for an ordinary piped run, which is what the surface's users
   * actually rely on. It is pinned separately from the case below BECAUSE that one moved: with
   * the local `&& stdout.isTTY` gone, this is now the assertion carrying "captured output stays
   * clean", and it holds through the ladder rather than through a local TTY check — rung 4 of
   * `config/colour.ts` auto-detects colour OFF for a non-TTY stdout, so `getUseColour()` is false
   * here in production and no ANSI is emitted.
   */
  it('is clean monochrome on a piped run — the ladder resolved colour off', async () => {
    systemUtilsMock.getUseColour.mockReturnValue(false);
    const { createPlainToolIndication } = await import('#src/core/plainToolIndication.js');
    const sink = vi.fn();
    const observer = createPlainToolIndication(sink);
    for (const chunk of readFileRound()) observer.observe(chunk);
    expect(sink.mock.calls[0][0]).not.toMatch(/\x1b\[/); // no ANSI at all
  });

  /**
   * TUI-C35 — MANDATED BEHAVIOUR CHANGE, not a test bent to fit a new implementation.
   *
   * This case previously asserted the exact opposite ("is clean monochrome on a non-TTY even when
   * useColour is on"). This module used to AND `getUseColour()` with `stdout.isTTY`, which is
   * redundant against the ladder in every case but one: `FORCE_COLOR` into a pipe. The ladder's
   * rung 1 resolves that to colour ON — forcing colour through a pipe being the whole purpose of
   * the variable — and the local narrowing then threw the answer away. TUI-C35 removed the
   * narrowing, so the forced case now reaches the output. The unforced piped case is unaffected
   * and stays pinned above.
   *
   * A resolved `true` on a piped run is reachable in production ONLY via `FORCE_COLOR` — rung 4
   * makes every other non-TTY route resolve false — so that single mocked value is the whole
   * scenario, and there is no TTY flag left for this case to set.
   */
  it('colours a piped run when FORCE_COLOR resolved the ladder on (behaviour changed by TUI-C35)', async () => {
    systemUtilsMock.getUseColour.mockReturnValue(true);
    const { createPlainToolIndication } = await import('#src/core/plainToolIndication.js');
    const sink = vi.fn();
    const observer = createPlainToolIndication(sink);
    for (const chunk of readFileRound()) observer.observe(chunk);
    expect(sink.mock.calls[0][0]).toMatch(/\x1b\[/); // colour survives the pipe, as asked for
  });

  it('colours the block (dim summary, green/red diff) when the ladder resolved colour on', async () => {
    systemUtilsMock.getUseColour.mockReturnValue(true);
    const { createPlainToolIndication } = await import('#src/core/plainToolIndication.js');
    const sink = vi.fn();
    const observer = createPlainToolIndication(sink);
    observer.observe(
      new AIMessageChunk({
        content: '',
        tool_call_chunks: [
          {
            name: 'edit_file',
            args: JSON.stringify({ path: 'a.ts', edits: [{ oldText: 'old', newText: 'new' }] }),
            id: 'c1',
            index: 0,
            type: 'tool_call_chunk',
          },
        ],
      })
    );
    observer.observe(new ToolMessage({ content: 'diff applied', tool_call_id: 'c1' }));
    const text = sink.mock.calls[0][0] as string;
    expect(text).toContain('\x1b[2m'); // dim summary
    expect(text).toContain('\x1b[31m- old\x1b[0m'); // removed = red
    expect(text).toContain('\x1b[32m+ new\x1b[0m'); // added = green
  });

  it('shows only the status tail for a shell-shaped result (live output already streamed raw)', async () => {
    const { createPlainToolIndication } = await import('#src/core/plainToolIndication.js');
    const sink = vi.fn();
    const observer = createPlainToolIndication(sink);
    observer.observe(
      new AIMessageChunk({
        content: '',
        tool_call_chunks: [
          {
            name: 'run_shell_command',
            args: '{"command":"ls"}',
            id: 'c1',
            index: 0,
            type: 'tool_call_chunk',
          },
        ],
      })
    );
    observer.observe(
      new ToolMessage({
        content:
          "Executing 'ls'...\n\n<COMMAND_OUTPUT>\nfile-a\nfile-b\n</COMMAND_OUTPUT>\n" +
          "\n\nCommand 'ls' completed successfully",
        tool_call_id: 'c1',
      })
    );
    const text = sink.mock.calls[0][0] as string;
    expect(text).toContain('run_shell_command(command=ls)');
    expect(text).toContain("Command 'ls' completed successfully");
    expect(text).not.toContain('file-a'); // the default sink already streamed it live
  });

  it('handles two parallel calls in one round, attributing each result by id', async () => {
    const { createPlainToolIndication } = await import('#src/core/plainToolIndication.js');
    const sink = vi.fn();
    const observer = createPlainToolIndication(sink);
    observer.observe(
      new AIMessageChunk({
        content: '',
        tool_call_chunks: [
          {
            name: 'read_file',
            args: '{"path":"a.txt"}',
            id: 'c1',
            index: 0,
            type: 'tool_call_chunk',
          },
          {
            name: 'read_file',
            args: '{"path":"b.txt"}',
            id: 'c2',
            index: 1,
            type: 'tool_call_chunk',
          },
        ],
      })
    );
    observer.observe(new ToolMessage({ content: 'body-a', tool_call_id: 'c1' }));
    observer.observe(new ToolMessage({ content: 'body-b', tool_call_id: 'c2' }));
    expect(sink).toHaveBeenCalledTimes(2);
    expect(sink.mock.calls[0][0]).toContain('read_file(path=a.txt)');
    expect(sink.mock.calls[0][0]).toContain('body-a');
    expect(sink.mock.calls[1][0]).toContain('read_file(path=b.txt)');
    expect(sink.mock.calls[1][0]).toContain('body-b');
  });

  it('re-uses chunk indexes across rounds without cross-attributing (reset on ToolMessage)', async () => {
    const { createPlainToolIndication } = await import('#src/core/plainToolIndication.js');
    const sink = vi.fn();
    const observer = createPlainToolIndication(sink);
    // Round 1, index 0.
    observer.observe(
      new AIMessageChunk({
        content: '',
        tool_call_chunks: [
          {
            name: 'read_file',
            args: '{"path":"a.txt"}',
            id: 'c1',
            index: 0,
            type: 'tool_call_chunk',
          },
        ],
      })
    );
    observer.observe(new ToolMessage({ content: 'body-a', tool_call_id: 'c1' }));
    // Round 2 restarts at index 0 (the OpenAI behaviour processEventStream also resets for).
    observer.observe(
      new AIMessageChunk({
        content: '',
        tool_call_chunks: [
          { name: 'run_tests', args: '{}', id: 'c2', index: 0, type: 'tool_call_chunk' },
        ],
      })
    );
    observer.observe(new ToolMessage({ content: 'suite green', tool_call_id: 'c2' }));
    expect(sink).toHaveBeenCalledTimes(2);
    expect(sink.mock.calls[1][0]).toContain('run_tests()');
    expect(sink.mock.calls[1][0]).toContain('suite green');
  });

  it('registers complete tool_calls from a non-chunk AIMessage (resumed runs)', async () => {
    const { createPlainToolIndication } = await import('#src/core/plainToolIndication.js');
    const sink = vi.fn();
    const observer = createPlainToolIndication(sink);
    observer.observe(
      new AIMessage({
        content: '',
        tool_calls: [{ id: 'c9', name: 'read_file', args: { path: 'x.md' } }],
      })
    );
    observer.observe(new ToolMessage({ content: 'x-body', tool_call_id: 'c9' }));
    expect(sink.mock.calls[0][0]).toContain('read_file(path=x.md)');
  });

  it('still renders (name from the ToolMessage) when the call was never tracked', async () => {
    const { createPlainToolIndication } = await import('#src/core/plainToolIndication.js');
    const sink = vi.fn();
    const observer = createPlainToolIndication(sink);
    observer.observe(
      new ToolMessage({ content: 'orphan body', tool_call_id: 'nope', name: 'mystery_tool' })
    );
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toContain('mystery_tool()');
    expect(sink.mock.calls[0][0]).toContain('orphan body');
  });

  // fix-cycle-1 regression — redact-before-truncate on the PLAIN surface end-to-end: a >48-char
  // patternless literal secret (held in a secret-named env var, passed as a tool arg) must be
  // FULLY redacted in the rendered summary, never a truncated head of it.
  it('fully redacts an over-cap patternless env secret in the params summary', async () => {
    const secret = 'deadbeef'.repeat(8); // 64 chars, matches no provider pattern
    systemUtilsMock.env = { MY_SERVICE_TOKEN: secret };
    const { createPlainToolIndication } = await import('#src/core/plainToolIndication.js');
    const sink = vi.fn();
    const observer = createPlainToolIndication(sink);
    observer.observe(
      new AIMessageChunk({
        content: '',
        tool_call_chunks: [
          {
            name: 'gth_web_fetch',
            args: JSON.stringify({ url: 'https://x.test', token: secret }),
            id: 'c1',
            index: 0,
            type: 'tool_call_chunk',
          },
        ],
      })
    );
    observer.observe(new ToolMessage({ content: 'fetched', tool_call_id: 'c1' }));
    const text = sink.mock.calls[0][0] as string;
    expect(text).toContain('token=<redacted>');
    expect(text).not.toContain('deadbeef'); // no leaked head anywhere in the block
  });

  // TUI-C32 residual e — the fail-soft try/catch used to wrap ONLY the ToolMessage branch; the
  // AIMessage branch(es) parse tool_calls (`JSON.stringify(tc.args)` can throw on an unserialisable
  // arg, e.g. a BigInt) unguarded. A throw there would break the run's stream loop. Wrap them too.
  it('fail-soft: an unserialisable tool_call arg in the AIMessage branch does not throw', async () => {
    const { createPlainToolIndication } = await import('#src/core/plainToolIndication.js');
    const sink = vi.fn();
    const observer = createPlainToolIndication(sink);
    // JSON.stringify throws on a BigInt — the AIMessage branch must swallow it like the ToolMessage
    // branch, never propagating out of observe().
    expect(() =>
      observer.observe(
        new AIMessage({
          content: '',
          tool_calls: [{ id: 'c1', name: 'read_file', args: { n: 1n } as never }],
        })
      )
    ).not.toThrow();
    // The observer stays usable: a subsequent well-formed round still renders.
    observer.observe(
      new AIMessage({
        content: '',
        tool_calls: [{ id: 'c2', name: 'read_file', args: { path: 'ok.md' } }],
      })
    );
    observer.observe(new ToolMessage({ content: 'body-ok', tool_call_id: 'c2' }));
    expect(sink.mock.calls.at(-1)?.[0]).toContain('read_file(path=ok.md)');
  });

  it('ignores plain text chunks and human messages entirely', async () => {
    const { createPlainToolIndication } = await import('#src/core/plainToolIndication.js');
    const sink = vi.fn();
    const observer = createPlainToolIndication(sink);
    observer.observe(new AIMessageChunk({ content: 'hello ' }));
    observer.observe(new HumanMessage('hi'));
    expect(sink).not.toHaveBeenCalled();
  });

  /**
   * [[TUI-C105]] — the configurable preview depth on THIS surface, which is the one `review` runs
   * on and therefore the one the originating issue is about. The depth is resolved in the shared
   * `toolDisplay` module, so these assert the setting actually reaches the rendered block rather
   * than only the helper; the Ink half lives in `packages/app/spec/tui/toolPreviewDepth.spec.tsx`.
   */
  describe('configurable preview depth (TUI-C105)', () => {
    const TWELVE_LINES = Array.from({ length: 12 }, (_, i) => `body-${i + 1}`).join('\n');

    /** One complete gth_gh_read_file round whose args ARE tracked. */
    const ghRound = (): Array<AIMessage | ToolMessage> => [
      new AIMessage({
        content: '',
        tool_calls: [
          {
            id: 'g1',
            name: 'gth_gh_read_file',
            args: { path: 'src/tenant/Community.ts' },
          },
        ],
      }),
      new ToolMessage({
        content: `Full contents of acme/widgets/src/tenant/Community.ts@main:\n\n${TWELVE_LINES}`,
        tool_call_id: 'g1',
      }),
    ];

    const renderRound = async (config: unknown, command?: 'review' | 'pr'): Promise<string> => {
      const { createPlainToolIndication } = await import('#src/core/plainToolIndication.js');
      const { setToolDisplayConfig } = await import('#src/core/toolDisplay.js');
      if (config !== undefined) setToolDisplayConfig(config, command);
      const sink = vi.fn();
      const observer = createPlainToolIndication(sink);
      for (const m of ghRound()) observer.observe(m);
      return sink.mock.calls[0][0] as string;
    };

    it('unconfigured, still prints the canonical 10-line preview and the overflow marker', async () => {
      const text = await renderRound(undefined);
      expect(text).toContain('Full contents of');
      expect(text).toContain('body-8');
      expect(text).toContain('… (+4 more lines)');
    });

    it('at depth 0 prints ONE line for the call, and that line names the file', async () => {
      const text = await renderRound({ builtInTools: { gth_gh_read_file: { previewLines: 0 } } });

      // The emitted block is a leading blank (the historical notice framing) + the summary row.
      const rows = text.split('\n').filter((r) => r.trim().length > 0);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toContain('gth_gh_read_file(path=src/tenant/Community.ts)');
      expect(rows[0]).toContain('📁'); // the registry entry's glyph, not the generic ⚙
      expect(text).not.toContain('Full contents of');
      expect(text).not.toContain('more lines');
    });

    it('at a small depth prints N body rows plus the overflow marker', async () => {
      const text = await renderRound({ toolOutputPreviewLines: 3 });
      const rows = text.split('\n').filter((r) => r.trim().length > 0);
      // The 3 body rows are the tool's `Full contents of …` preamble, the blank line after it, and
      // body-1. Counting NON-BLANK rows therefore gives 4: summary + preamble + body-1 + marker.
      expect(rows).toHaveLength(4);
      expect(text).toContain('body-1');
      expect(text).not.toContain('body-2');
      // 14 body lines in all (preamble + its blank line + 12), 3 shown, so 11 are accounted for.
      expect(text).toContain('… (+11 more lines)');
    });

    it('honours a per-command override for the command that is running', async () => {
      const config = {
        toolOutputPreviewLines: 5,
        commands: { review: { builtInTools: { gth_gh_read_file: { previewLines: 0 } } } },
      };
      const underReview = await renderRound(config, 'review');
      expect(underReview.split('\n').filter((r) => r.trim().length > 0)).toHaveLength(1);

      vi.resetModules();
      const underPr = await renderRound(config, 'pr');
      expect(underPr).toContain('body-1');
    });
  });
});
