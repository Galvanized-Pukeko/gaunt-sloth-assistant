import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIMessageChunk, ToolMessage } from '@langchain/core/messages';
import { StatusLevel } from '#src/core/types.js';

/**
 * [[TUI-C108]] — the plain surface's tool status row is levelled BY OUTCOME, so a quieted console
 * can keep failures while dropping successes.
 *
 * These cells drive the REAL production path — `createPlainToolIndication()` with its default
 * `emit`, which is the real `displayToolIndication` — rather than an injected sink, because the
 * thing under test is the level the row is written at and an injected sink never reaches the gate.
 * `systemUtils` is the only mock, so what is asserted is the exact bytes that would reach the
 * user's terminal.
 */
const systemUtilsMock = {
  getUseColour: vi.fn(),
  initLogStream: vi.fn(),
  writeToLogStream: vi.fn(),
  closeLogStream: vi.fn(),
  log: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  stream: vi.fn(),
  env: {} as Record<string, string | undefined>,
};
vi.mock('#src/utils/systemUtils.js', () => systemUtilsMock);

const debugUtilsMock = { debugLog: vi.fn(), debugLogError: vi.fn() };
vi.mock('#src/utils/debugUtils.js', () => debugUtilsMock);

/** A non-shell tool whose body is NOT suppressed by the live-output dedupe. */
const TOOL = 'read_file';
const ERROR_TEXT = [
  'ENOENT: no such file or directory',
  "  at readFile ('/repo/missing.ts')",
  '  code: ENOENT',
  '  errno: -2',
].join('\n');

/** One streamed round for `read_file`, closed by a ToolMessage with the given outcome. */
function round(result: string, status?: 'error'): Array<AIMessageChunk | ToolMessage> {
  return [
    new AIMessageChunk({
      content: '',
      tool_call_chunks: [
        {
          name: TOOL,
          args: '{"path":"README.md"}',
          id: 'call-1',
          index: 0,
          type: 'tool_call_chunk',
        },
      ],
    }),
    new ToolMessage({
      content: result,
      tool_call_id: 'call-1',
      ...(status ? { status } : {}),
    }),
  ];
}

/** Load the production modules fresh and drive one round through the real emit path. */
async function emitRound(
  opts: {
    result?: string;
    status?: 'error';
    raterClarification?: boolean;
    consoleLevel?: StatusLevel;
    displayConfig?: unknown;
  } = {}
): Promise<void> {
  const consoleUtils = await import('#src/utils/consoleUtils.js');
  const { createPlainToolIndication } = await import('#src/core/plainToolIndication.js');
  const toolDisplay = await import('#src/core/toolDisplay.js');

  toolDisplay.resetToolDisplaySecretsCacheForTests();
  if (opts.displayConfig !== undefined) toolDisplay.setToolDisplayConfig(opts.displayConfig);
  consoleUtils.initSessionLogging('session.log', true);
  consoleUtils.setConsoleLevel(opts.consoleLevel ?? StatusLevel.INFO);

  const observer = createPlainToolIndication(undefined, () => opts.raterClarification === true);
  for (const chunk of round(opts.result ?? 'line-1\nline-2', opts.status)) observer.observe(chunk);
}

/** Everything written to the console channel `displayToolIndication` uses. */
const blocks = (): string[] => systemUtilsMock.info.mock.calls.map((c) => c[0] as string);

/**
 * The exact blocks the base commit emits at the default level, captured from a run against the
 * unmodified tree rather than written from belief. Whole strings, because the acceptance is
 * byte-identity and a `toContain` would pass on a block that had gained or lost a line.
 */
const BASE_SUCCESS = '\n✓ 📁 read_file(path=README.md)\n    line-1\n    line-2';
const BASE_ERROR =
  '\n✗ 📁 read_file(path=README.md)\n' +
  '    ENOENT: no such file or directory\n' +
  "      at readFile ('/repo/missing.ts')\n" +
  '      code: ENOENT\n' +
  '      errno: -2';
const BASE_CLARIFICATION =
  '\n⚠ 📁 read_file(path=README.md)  [auto-rater: clarification requested]\n' +
  '    ENOENT: no such file or directory\n' +
  "      at readFile ('/repo/missing.ts')\n" +
  '      code: ENOENT\n' +
  '      errno: -2';

describe('TUI-C108 — the tool status row is levelled by outcome', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
    systemUtilsMock.getUseColour.mockReturnValue(false);
    systemUtilsMock.env = {};
  });

  /**
   * The load-bearing regression pin: at the DEFAULT console level nothing about this change may
   * reach a user who did not ask for it. Asserted as whole-string equality on the exact bytes,
   * and on the CHANNEL, so a future move of the error row to stderr reds here rather than in
   * somebody's terminal.
   */
  describe('byte-identical at the default INFO level', () => {
    it('success renders exactly as before, on the info channel', async () => {
      await emitRound();
      expect(blocks()).toEqual([BASE_SUCCESS]);
      expect(systemUtilsMock.log).not.toHaveBeenCalled();
      expect(systemUtilsMock.warn).not.toHaveBeenCalled();
      expect(systemUtilsMock.error).not.toHaveBeenCalled();
    });

    it('an error renders exactly as before, on the info channel', async () => {
      await emitRound({ result: ERROR_TEXT, status: 'error' });
      expect(blocks()).toEqual([BASE_ERROR]);
      expect(systemUtilsMock.log).not.toHaveBeenCalled();
      expect(systemUtilsMock.warn).not.toHaveBeenCalled();
      expect(systemUtilsMock.error).not.toHaveBeenCalled();
    });

    it('a rater clarification renders exactly as before, on the info channel', async () => {
      await emitRound({ result: ERROR_TEXT, status: 'error', raterClarification: true });
      expect(blocks()).toEqual([BASE_CLARIFICATION]);
      expect(systemUtilsMock.log).not.toHaveBeenCalled();
      expect(systemUtilsMock.warn).not.toHaveBeenCalled();
    });

    it('writes the same block to the session log, ANSI-stripped', async () => {
      await emitRound();
      expect(systemUtilsMock.writeToLogStream).toHaveBeenCalledWith(BASE_SUCCESS + '\n');
    });
  });

  describe('at consoleLevel display, with the preview depth set to 0', () => {
    const quiet = {
      consoleLevel: StatusLevel.DISPLAY,
      displayConfig: { toolOutputPreviewLines: 0 },
    };

    it('a successful call prints NOTHING — not to the console, not to the session log', async () => {
      await emitRound(quiet);
      expect(systemUtilsMock.info).not.toHaveBeenCalled();
      expect(systemUtilsMock.log).not.toHaveBeenCalled();
      expect(systemUtilsMock.warn).not.toHaveBeenCalled();
      expect(systemUtilsMock.writeToLogStream).not.toHaveBeenCalled();
    });

    it('a failed call prints its status row AND enough of the error to explain itself', async () => {
      await emitRound({ ...quiet, result: ERROR_TEXT, status: 'error' });

      expect(systemUtilsMock.info).toHaveBeenCalledTimes(1);
      const block = blocks()[0];
      const [, head, ...body] = block.split('\n');

      expect(head).toContain('✗');
      expect(head).toContain('read_file(path=README.md)');
      // The floor, asserted on the ERROR TEXT rather than a line count alone: a count-only
      // assertion passes on the useless version of this, where three lines survive and none of
      // them says what went wrong.
      expect(block).toContain('ENOENT: no such file or directory');
      expect(body.length).toBeGreaterThanOrEqual(3);
    });

    it('a rater clarification still renders distinguishably', async () => {
      await emitRound({ ...quiet, result: ERROR_TEXT, status: 'error', raterClarification: true });

      expect(systemUtilsMock.info).toHaveBeenCalledTimes(1);
      const block = blocks()[0];
      // The glyph and the WORDS, not the colour: TUI-C69 §5.4 requires the distinction to survive
      // a terminal with no colour at all, and this cell runs with colour off.
      expect(block).toContain('⚠');
      expect(block).toContain('auto-rater: clarification requested');
      expect(block).not.toContain('✗');
    });
  });
});
