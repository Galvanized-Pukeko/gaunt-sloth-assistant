import { describe, expect, it } from 'vitest';
import React from 'react';
import { EventEmitter } from 'node:events';
import { render as inkRender } from 'ink';
import stripAnsi from 'strip-ansi';
import { StatusBar, approvalsBadgeSpellings, statusBarRow } from '#src/tui/components/StatusBar.js';

/**
 * TUI-C92 — **the status bar is one row at every width, and it gives things up in a fixed order.**
 *
 * The dock's row budget counts the bar as one row, and a bar that wraps takes the second row out
 * of the conversation's floor without the budget knowing. So the bar is made unable to wrap
 * (DL-7): the render truncates, and the pure `statusBarRow` decides what to sacrifice first so
 * that truncation is the last resort rather than the first. The order — provider, then the rater
 * profile on the approvals badge, then `…` — is asserted at four widths, each one step narrower.
 *
 * The `⚡ Bypass` badge is the exception to "the badge gives way first": it is the one badge whose
 * absence would misreport a posture with no gate at all, so at `bypass` the badge is the part of
 * the row that refuses to shrink and the segments' tail gives way to it — `ready`, then the turn
 * counter — and it is asserted whole at every width down to the floor, the width that holds mode +
 * model + the `…` the clipped segments end in + badge. Below that floor the model itself is
 * clipped and the badge still holds.
 *
 * The debug hint is the lowest priority on the row at every rung: neither drop reserves a cell for
 * it, so it gets only the room the segments and the badge leave — clipped, or left out — before
 * the profile goes, before the provider goes, and before the badge (other rungs) or the segments'
 * tail (`bypass`) shrink. That is arithmetic in `statusBarRow`, so it is asserted on the decision
 * and on the row.
 *
 * Widths are chosen from the measured strings: the segments with the provider are 69 cells and
 * without it 56, of which the mode and the `model: ` label are 16; the full badge is 37, the short
 * one 24, the bypass badge 10, the hint 27.
 */

/** A stdout with a width, so the row's fit is decided at the width the spec names. */
class SizedStdout extends EventEmitter {
  frames: string[] = [];
  rows = 24;
  constructor(public columns: number) {
    super();
  }
  write = (frame: string) => {
    this.frames.push(frame);
  };
  lastFrame = () => this.frames[this.frames.length - 1];
}

class FakeStdin extends EventEmitter {
  isTTY = true;
  setEncoding() {}
  setRawMode() {}
  resume() {}
  pause() {}
  ref() {}
  unref() {}
  read = () => null;
}

/** The bar's frame at `columns`, ANSI stripped, as rows. */
function barRowsAt(columns: number, node: React.ReactElement): string[] {
  const stdout = new SizedStdout(columns);
  const instance = inkRender(node, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: new FakeStdin() as unknown as NodeJS.ReadStream,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  const rows = stripAnsi(stdout.lastFrame() ?? '').split('\n');
  instance.unmount();
  return rows;
}

const input = {
  mode: 'code',
  modelDisplayName: 'claude-sonnet-4-5',
  modelProviderType: 'openrouter',
  turnCount: 2,
};
const WITH_PROVIDER = 'code  ·  model: claude-sonnet-4-5 (openrouter)  ·  turns: 2  ·  ready';
const BARE = 'code  ·  model: claude-sonnet-4-5  ·  turns: 2  ·  ready';
const FULL_BADGE = '  ·  approvals: Assisted (auto-rater)';
const SHORT_BADGE = '  ·  approvals: Assisted';
const BYPASS = ' ⚡ Bypass';
const DEBUG_HINT = '  ·  Tab: focus debug panel';

const assisted = { rung: 'assisted' as const };
const bypass = { rung: 'bypass' as const };

const bar = (columns: number, approvals: { rung: 'assisted' | 'bypass' }, debugHint = false) => (
  <StatusBar
    running={false}
    {...input}
    columns={columns}
    approvals={approvals}
    debugHint={debugHint}
  />
);

/** An idle bypass session on a long openrouter-style id, whose `provider/` prefix is ordinary. */
const bypassBar = (columns: number, modelDisplayName: string, debugHint = false) => (
  <StatusBar
    running={false}
    mode="chat"
    modelDisplayName={modelDisplayName}
    modelProviderType="openrouter"
    turnCount={0}
    columns={columns}
    approvals={bypass}
    debugHint={debugHint}
  />
);

const runningBypassRows = (columns: number) =>
  barRowsAt(
    columns,
    <StatusBar running mode="code" turnCount={2} columns={columns} approvals={bypass} />
  );

describe('the status bar gives way in order and stays one row (TUI-C92)', () => {
  it('120 columns: everything fits, nothing is sacrificed', () => {
    expect(statusBarRow({ ...input, columns: 120, approvals: assisted })).toEqual({
      segments: WITH_PROVIDER,
      badge: FULL_BADGE,
    });
    expect(barRowsAt(120, bar(120, assisted))).toEqual([`${WITH_PROVIDER}${FULL_BADGE}`]);
    expect(barRowsAt(120, bar(120, bypass))).toEqual([`${WITH_PROVIDER}${BYPASS}`]);
  });

  it('100 columns: the provider goes first, the rater profile stays', () => {
    expect(statusBarRow({ ...input, columns: 100, approvals: assisted })).toEqual({
      segments: BARE,
      badge: FULL_BADGE,
    });
    expect(barRowsAt(100, bar(100, assisted))).toEqual([`${BARE}${FULL_BADGE}`]);
    expect(barRowsAt(100, bar(100, bypass))).toEqual([`${WITH_PROVIDER}${BYPASS}`]);
  });

  it('85 columns: the rater profile goes second, the badge still says the rung', () => {
    expect(statusBarRow({ ...input, columns: 85, approvals: assisted })).toEqual({
      segments: BARE,
      badge: SHORT_BADGE,
    });
    // Exactly, not `toContain`: a badge that kept its profile would be truncated here instead,
    // and `approvals: Assisted` would still be in the row.
    expect(barRowsAt(85, bar(85, assisted))).toEqual([`${BARE}${SHORT_BADGE}`]);
    expect(barRowsAt(85, bar(85, bypass))).toEqual([`${WITH_PROVIDER}${BYPASS}`]);
  });

  it('70 columns: only then the badge truncates with …, and the model is untouched', () => {
    // The pure decision has nothing left to drop; the render truncates the badge, never the
    // segments, because the segments refuse to shrink.
    expect(statusBarRow({ ...input, columns: 70, approvals: assisted })).toEqual({
      segments: BARE,
      badge: SHORT_BADGE,
    });
    const rows = barRowsAt(70, bar(70, assisted));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toBe(`${BARE}  ·  approval…`);
    expect(rows[0]).toHaveLength(70);
    // The bypass badge is ten cells and fits beside the bare segments here: intact.
    expect(barRowsAt(70, bar(70, bypass))).toEqual([`${BARE}${BYPASS}`]);
  });

  it('50 columns, narrower than the segments themselves: still one row, ending in …', () => {
    const rows = barRowsAt(50, bar(50, assisted));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(50);
    expect(rows[0]).toMatch(/…$/);
    expect(rows[0].startsWith('code  ·  model: claude-sonnet-4-5')).toBe(true);
  });

  it('keeps the ⚡ Bypass badge at 80 columns with a 26-cell model id', () => {
    const rows = barRowsAt(
      80,
      <StatusBar
        running={false}
        mode="chat"
        modelDisplayName="claude-sonnet-4-5-20250929"
        modelProviderType="anthropic"
        turnCount={0}
        columns={80}
        approvals={bypass}
      />
    );
    expect(rows).toEqual([
      'chat  ·  model: claude-sonnet-4-5-20250929  ·  turns: 0  ·  ready ⚡ Bypass',
    ]);
  });

  it('93 columns keeps the full badge at exactly the width it fits, and 92 drops the profile', () => {
    // The bare segments (56) and the full badge (37) are 93 cells: the boundary is `<=`, and a
    // `<` would drop the profile one width too early.
    expect(`${BARE}${FULL_BADGE}`).toHaveLength(93);
    expect(statusBarRow({ ...input, columns: 93, approvals: assisted })).toEqual({
      segments: BARE,
      badge: FULL_BADGE,
    });
    expect(barRowsAt(93, bar(93, assisted))).toEqual([`${BARE}${FULL_BADGE}`]);
    expect(statusBarRow({ ...input, columns: 92, approvals: assisted })).toEqual({
      segments: BARE,
      badge: SHORT_BADGE,
    });
    expect(barRowsAt(92, bar(92, assisted))).toEqual([`${BARE}${SHORT_BADGE}`]);
  });

  it.each([
    [
      'anthropic/claude-3-5-sonnet-20241022',
      'chat  ·  model: anthropic/claude-3-5-sonnet-20241022  ·  turns: 0  · …',
    ],
    [
      'google/gemini-2.5-flash-preview-05-20',
      'chat  ·  model: google/gemini-2.5-flash-preview-05-20  ·  turns: 0  ·…',
    ],
  ])(
    '80 columns, bypass, a long openrouter id (%s): the badge holds, the segments give way',
    (id, segments) => {
      // The segments are 75 and 76 cells beside a 10-cell badge; the badge is the part that
      // refuses to shrink, so the `…` lands in the segments' tail and the model stays whole.
      const rows = barRowsAt(80, bypassBar(80, id));
      expect(rows).toEqual([`${segments}${BYPASS}`]);
      // Each of the three named, so a failure says which one went.
      expect(rows[0].endsWith(BYPASS)).toBe(true);
      expect(rows[0]).toContain(`model: ${id}  ·  turns: 0`);
      expect(rows[0].slice(0, -BYPASS.length)).toMatch(/…$/);
    }
  );

  it.each([
    [65, 'code  ·  model: claude-sonnet-4-5  ·  turns: 2  ·  rea…'],
    [60, 'code  ·  model: claude-sonnet-4-5  ·  turns: 2  ·…'],
    [50, 'code  ·  model: claude-sonnet-4-5  ·  t…'],
  ])(
    '%i columns, bypass: the badge and the model whole, `ready` then the turn counter give way',
    (columns, segments) => {
      const rows = barRowsAt(columns, bar(columns, bypass));
      expect(rows).toEqual([`${segments}${BYPASS}`]);
      expect(rows[0]).toContain('model: claude-sonnet-4-5  ·');
    }
  );

  it('40 columns, bypass — the stated floor: below mode + model + … + badge the model is clipped', () => {
    // 16 cells of mode and label, 17 of model, one for the `…` the clipped segments end in, 10 of
    // badge: 44 is the narrowest width that holds the model whole, and at 43 the ellipsis takes
    // the model's last character. Below that the model is the last thing left on the segments'
    // side and truncates; the badge still does not. That is the floor the bar is designed to,
    // not a defect.
    expect(barRowsAt(44, bar(44, bypass))).toEqual([`code  ·  model: claude-sonnet-4-5…${BYPASS}`]);
    expect(barRowsAt(43, bar(43, bypass))).toEqual([`code  ·  model: claude-sonnet-4-…${BYPASS}`]);
    const rows = barRowsAt(40, bar(40, bypass));
    expect(rows).toEqual([`code  ·  model: claude-sonnet…${BYPASS}`]);
    expect(rows[0].endsWith(BYPASS)).toBe(true);
  });

  it('keeps the ⚡ Bypass badge whole on the running row, and truncates the interrupt hint', () => {
    // 40 columns hold the spinner and hint (30 cells) beside the badge (10) exactly; below that
    // the hint is the part that gives way, never the badge.
    expect(runningBypassRows(40)).toHaveLength(1);
    expect(runningBypassRows(40)[0]).toMatch(/^. Thinking… \(Esc to interrupt\) ⚡ Bypass$/);
    expect(runningBypassRows(39)).toHaveLength(1);
    expect(runningBypassRows(39)[0]).toMatch(/^. Thinking… \(Esc to interrup… ⚡ Bypass$/);
    expect(runningBypassRows(30)).toHaveLength(1);
    expect(runningBypassRows(30)[0]).toMatch(/^. Thinking… \(Esc to… ⚡ Bypass$/);
  });

  it('gives the debug hint only the room the segments and the badge leave, at every width', () => {
    // Neither drop reserves a cell for the hint, so it never costs the provider or the profile:
    // with the provider and the full badge (106 cells) both fitting, 120 leaves the hint 14
    // cells, 110 leaves it 4, and 106 none at all.
    const decide = (columns: number) =>
      statusBarRow({ ...input, columns, approvals: assisted, debugHint: true });
    expect(decide(120)).toEqual({
      segments: WITH_PROVIDER,
      badge: FULL_BADGE,
      hint: '  ·  Tab: foc…',
    });
    expect(barRowsAt(120, bar(120, assisted, true))).toEqual([
      `${WITH_PROVIDER}${FULL_BADGE}  ·  Tab: foc…`,
    ]);
    expect(decide(110)).toEqual({ segments: WITH_PROVIDER, badge: FULL_BADGE, hint: '  ·…' });
    expect(barRowsAt(110, bar(110, assisted, true))).toEqual([`${WITH_PROVIDER}${FULL_BADGE}  ·…`]);
    expect(decide(106)).toEqual({ segments: WITH_PROVIDER, badge: FULL_BADGE });
    expect(barRowsAt(106, bar(106, assisted, true))).toEqual([`${WITH_PROVIDER}${FULL_BADGE}`]);
    // The provider goes at 105 exactly as it would with no hint at all, and the room that frees
    // goes to the hint: at 100 the profile is kept and the hint gets the seven cells left.
    expect(decide(105).segments).toBe(BARE);
    expect(decide(100)).toEqual({ segments: BARE, badge: FULL_BADGE, hint: '  ·  T…' });
    expect(barRowsAt(100, bar(100, assisted, true))).toEqual([`${BARE}${FULL_BADGE}  ·  T…`]);
    // The profile goes at 92, as it does with no hint at all (the 93/92 cell), never earlier.
    expect(decide(93)).toEqual({ segments: BARE, badge: FULL_BADGE });
    expect(decide(92)).toEqual({ segments: BARE, badge: SHORT_BADGE, hint: '  ·  Tab: f…' });
    expect(barRowsAt(92, bar(92, assisted, true))).toEqual([`${BARE}${SHORT_BADGE}  ·  Tab: f…`]);
    // One cell of room draws the ellipsis alone; none leaves the hint out, and the row is then
    // exactly the segments and the badge — which fit 80 to the cell.
    expect(decide(81).hint).toBe('…');
    expect(decide(80).hint).toBeUndefined();
    expect(decide(80)).toEqual({ segments: BARE, badge: SHORT_BADGE });
    expect(barRowsAt(80, bar(80, assisted, true))).toEqual([`${BARE}${SHORT_BADGE}`]);
    // Only below that does the badge give way, exactly as it does with no hint at all.
    expect(barRowsAt(70, bar(70, assisted, true))).toEqual([`${BARE}  ·  approval…`]);
  });

  it('bypass: the provider is no longer dropped merely to keep the hint whole', () => {
    // With the provider the segments are 69 cells; beside the 10-cell badge they fit from 79 up,
    // and the hint gets what is left — whole at 110, clipped at 100, nothing at 79. At 78 the
    // provider goes because it no longer fits beside the badge, not to make room for the hint,
    // and the room that frees goes to the hint.
    const decide = (columns: number) =>
      statusBarRow({ ...input, columns, approvals: bypass, debugHint: true });
    expect(decide(110)).toEqual({ segments: WITH_PROVIDER, badge: BYPASS, hint: DEBUG_HINT });
    expect(decide(100)).toEqual({
      segments: WITH_PROVIDER,
      badge: BYPASS,
      hint: '  ·  Tab: focus debu…',
    });
    expect(barRowsAt(100, bar(100, bypass, true))).toEqual([
      `${WITH_PROVIDER}${BYPASS}  ·  Tab: focus debu…`,
    ]);
    expect(decide(79)).toEqual({ segments: WITH_PROVIDER, badge: BYPASS });
    expect(barRowsAt(79, bar(79, bypass, true))).toEqual([`${WITH_PROVIDER}${BYPASS}`]);
    expect(decide(78)).toEqual({ segments: BARE, badge: BYPASS, hint: '  ·  Tab: f…' });
    expect(barRowsAt(78, bar(78, bypass, true))).toEqual([`${BARE}${BYPASS}  ·  Tab: f…`]);
  });

  it('80 columns, bypass, a 36-cell id, the debug hint open: the hint goes first, the badge and model hold', () => {
    const id = 'anthropic/claude-3-5-sonnet-20241022';
    const decide = (columns: number) =>
      statusBarRow({
        mode: 'chat',
        modelDisplayName: id,
        modelProviderType: 'openrouter',
        turnCount: 0,
        columns,
        approvals: bypass,
        debugHint: true,
      });
    // 75 cells of segments and the 10-cell badge leave the hint no room at 80: it is out, and the
    // row is the one the hint-less cell pins — model whole, `…` in the tail, the badge whole.
    expect(decide(80)).toEqual({
      segments: `chat  ·  model: ${id}  ·  turns: 0  ·  ready`,
      badge: BYPASS,
    });
    const rows = barRowsAt(80, bypassBar(80, id, true));
    expect(rows).toEqual([`chat  ·  model: ${id}  ·  turns: 0  · …${BYPASS}`]);
    expect(rows[0].endsWith(BYPASS)).toBe(true);
    expect(rows[0]).toContain(`model: ${id}  ·  turns: 0`);
    // Wider, it is the hint that is clipped and the segments stay whole: 85 holds the bare
    // segments and the badge exactly. The provider comes back the moment it fits beside the badge
    // (98, exactly), and the hint gets only what is left after that — two cells at 100.
    expect(barRowsAt(85, bypassBar(85, id, true))).toEqual([
      `chat  ·  model: ${id}  ·  turns: 0  ·  ready${BYPASS}`,
    ]);
    expect(barRowsAt(98, bypassBar(98, id, true))).toEqual([
      `chat  ·  model: ${id} (openrouter)  ·  turns: 0  ·  ready${BYPASS}`,
    ]);
    expect(barRowsAt(100, bypassBar(100, id, true))).toEqual([
      `chat  ·  model: ${id} (openrouter)  ·  turns: 0  ·  ready${BYPASS} …`,
    ]);
  });

  it('keeps the running row to one row by the same means', () => {
    // Wide: the spinner, the interrupt hint and the badge, on one row.
    const wide = barRowsAt(
      120,
      <StatusBar running mode="code" turnCount={2} columns={120} approvals={assisted} />
    );
    expect(wide).toHaveLength(1);
    expect(wide[0]).toContain('Thinking… (Esc to interrupt)');
    expect(wide[0]).toContain('approvals: Assisted');
    // Narrow: the badge truncates; the hint is the part that refuses to shrink.
    const narrow = barRowsAt(
      40,
      <StatusBar running mode="code" turnCount={2} columns={40} approvals={assisted} />
    );
    expect(narrow).toHaveLength(1);
    expect(narrow[0]).toContain('Thinking… (Esc to interrupt)');
    expect(narrow[0]).toHaveLength(40);
    expect(narrow[0]).toMatch(/…$/);
    // Narrower than the interrupt hint itself (30 cells): the hint truncates rather than wraps,
    // which is the case the badge's truncation cannot cover for it.
    const tiny = barRowsAt(
      20,
      <StatusBar running mode="code" turnCount={2} columns={20} approvals={assisted} />
    );
    expect(tiny).toHaveLength(1);
    expect(tiny[0]).toHaveLength(20);
    expect(tiny[0]).toMatch(/^. Thinking… \(Esc to…$/);
  });

  it('spells every badge the same with or without a profile to drop', () => {
    // No profile: the short and full spellings coincide, and the row is the same at every width.
    for (const rung of ['manual', 'write'] as const) {
      const row = statusBarRow({ ...input, columns: 80, approvals: { rung } });
      expect(row.badge).toMatch(/^ {2}· {2}approvals: /);
      expect(row.badge).not.toContain('(');
    }
    // A named rater profile is what the full spelling carries.
    expect(
      statusBarRow({ ...input, columns: 200, approvals: { rung: 'auto', raterProfile: 'strict' } })
        .badge
    ).toBe('  ·  approvals: Auto (strict)');
    // `bypass` has no profile either, and one spelling: both halves are the badge, exactly.
    expect(approvalsBadgeSpellings(bypass)).toEqual({ full: BYPASS, short: BYPASS });
    // No approvals surface at all: no badge, and the decision degrades to the segments alone.
    expect(statusBarRow({ ...input, columns: 200 })).toEqual({ segments: WITH_PROVIDER });
  });
});
