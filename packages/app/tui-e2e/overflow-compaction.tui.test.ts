import path from 'node:path';
import { test, expect } from '@microsoft/tui-test';
import type { Terminal } from '@microsoft/tui-test';
import { settleSessionsAfterEach } from './fixtures/tmpHome.mjs';

settleSessionsAfterEach(test);

// tui-test keeps process.cwd() at the invocation dir (this folder); the cli lives one level up.
const e2eDir = process.cwd();
const cli = path.resolve(e2eDir, '..', 'cli.js');
const fixture = (name: string): string => path.resolve(e2eDir, 'fixtures', name);

/** Build the child env — see `chat.tui.test.ts` for why `CI` is deleted rather than blanked. */
const envFor = (fixtureName: string): Record<string, string | undefined> => {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.CI;
  delete env.GTH_NO_TUI;
  env.TERM = 'xterm-256color';
  env.GTH_TUI_E2E_FIXTURE = fixture(fixtureName);
  return env;
};

const screenRows = (terminal: Terminal): string[] =>
  terminal
    .serialize()
    .view.split('\n')
    .slice(1, -1)
    .map((line) => line.replace(/^│/, '').replace(/│$/, ''));

/**
 * [[EXT-167]] — a compaction the session applied ON ITS OWN, mid-turn, in the real TUI.
 *
 * The runtime folds the older conversation and retries when the provider rejects a turn for size,
 * and says so on the stream with a `context_compacted` event. What this cell pins is the one thing
 * a unit test over the view model cannot: that the notice PAINTS in a terminal at the point in the
 * turn where the fold happened — under the tool call that ran before it, over the answer the retry
 * produced — with the same block `/compact` commits, and that it is still there once the turn is
 * committed to the transcript.
 */
test.describe('gth chat TUI — a compaction applied mid-turn (EXT-167)', () => {
  test.use({
    program: { file: 'node', args: [cli, 'chat', '--tui'] },
    env: envFor('overflow-compaction.json'),
    columns: 100,
    rows: 40,
  });

  test('paints the notice between the tool call and the answer, with the fold numbers', async ({
    terminal,
  }) => {
    await expect(terminal.getByText('ready to chat')).toBeVisible();

    terminal.write('go');
    await expect(terminal.getByText('> go')).toBeVisible();
    terminal.submit();

    // The whole turn, committed: the last text run is the final thing the fixture streams.
    await expect(terminal.getByText('after-fold-run')).toBeVisible();
    await expect(terminal.getByText('chat  ·  turns: 1  ·  ready')).toBeVisible();

    // The notice's words are the shared builder's, so the numbers a reader would check are here.
    await expect(terminal.getByText('Context overflowed — conversation compacted')).toBeVisible();
    await expect(terminal.getByText('9 older messages were folded into a summary')).toBeVisible();
    await expect(terminal.getByText('Model context: 15 messages')).toBeVisible();
    await expect(terminal.getByText('Nothing already on screen was undone')).toBeVisible();

    const rows = screenRows(terminal);
    const rowOf = (needle: string): number => {
      const at = rows.findIndex((row) => row.includes(needle));
      if (at === -1) {
        throw new Error(`"${needle}" is not on screen; frame was:\n${rows.join('\n')}`);
      }
      return at;
    };
    const before = rowOf('before-fold-run');
    const tool = rowOf('read_file(path=alpha.txt)');
    const title = rowOf('Context overflowed — conversation compacted');
    const after = rowOf('after-fold-run');
    // The order is the claim: the work that preceded the fold, the fold, then the continuation.
    // A notice committed as its own transcript item would sit above `before-fold-run`.
    expect(before).toBeLessThan(tool);
    expect(tool).toBeLessThan(title);
    expect(title).toBeLessThan(after);
  });
});
