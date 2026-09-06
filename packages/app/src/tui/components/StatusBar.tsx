import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { ApprovalRung } from '@gaunt-sloth/core/config.js';
import { APPROVAL_RUNG_LABELS, isRatedRung } from '@gaunt-sloth/core/config.js';
import { modelProviderLabel } from '@gaunt-sloth/core/core/modelLabel.js';
import { displayWidth } from '@gaunt-sloth/core/utils/displayWidth.js';

/** Separates the bar's segments, and the unit the width budget is spent in. */
const SEPARATOR = '  ·  ';

/**
 * The trailing hint, as its own sibling `<Text>`; a constant so `hintAsDrawn` can clip it by cell.
 * Its width is NOT reserved by any drop decision — it takes only the room the rest of the row leaves.
 */
const DEBUG_HINT_TEXT = '  ·  Tab: focus debug panel';

/**
 * The hint as the row draws it, given the columns left beside the segments and the badge: whole
 * when it fits, its first `room - 1` cells and `…` when it does not, nothing when there is not a
 * cell to draw it in.
 *
 * Arithmetic rather than layout, because the hint is the FIRST thing on the row to give way, at
 * every rung — it is the least informative element there (Tab focuses the panel whether or not
 * the hint is drawn) — and a layout engine cannot be told "this one first": Yoga shares an
 * overflow between shrinkable siblings in proportion to their widths, and skewing that with a
 * large `flexShrink` on the hint leaves the others a fraction of a cell short, which a `<Text>`
 * inside a box renders as a lost character, and draws a stray `…` at the width where the hint's
 * share drops below one cell. The hint is single-cell characters throughout, so a string slice is
 * a cell slice.
 */
function hintAsDrawn(room: number): string | undefined {
  if (room < 1) return undefined;
  if (displayWidth(DEBUG_HINT_TEXT) <= room) return DEBUG_HINT_TEXT;
  return `${DEBUG_HINT_TEXT.slice(0, room - 1)}…`;
}

/** Width assumed when the terminal width is unknown (non-TTY / tests) — as in `ruleWidth`. */
const DEFAULT_COLUMNS = 80;

/** Live `stdout.columns` as the integer the budget is spent in; unknown falls back to 80. */
function resolveColumns(columns: number | undefined): number {
  return typeof columns === 'number' && Number.isFinite(columns)
    ? Math.floor(columns)
    : DEFAULT_COLUMNS;
}

/**
 * CFG-38 — assemble the idle bar's dim segment run, and make the ONE width decision this bar has.
 *
 * Pure, and exported, for the reason `ruleWidth` and `launchBannerRows` are: the decision below is
 * width-conditional, and a rule that only exists inside a React render can only be tested by
 * driving a terminal. `columns` is a parameter rather than a `useStdout()` read for the same
 * reason `ApprovalStopMessage` takes one.
 *
 * ## Why the PROVIDER is the half that goes
 *
 * This is the one surface where `model (provider)` has a real cost: a single line already carrying
 * the mode, a turn counter, an approvals badge and sometimes a debug hint, all competing for the
 * terminal's width. Every other surface in this node renders into a block that can afford the
 * extra columns; this one cannot, so it is the one place a width-conditional omission is right.
 *
 * When the full line does not fit, the **provider** is dropped and the model is kept — never the
 * other way round, and neither is ever truncated. The model is the more informative half (it is
 * what the user chose), and a clipped `openrou…` or `claude-sonnet-4…` is misleading rather than
 * merely terse, which is the same reason the launch banner DROPS a version it cannot fit instead
 * of clipping it. Dropping the provider costs the disambiguation this node adds; clipping either
 * half would cost correctness.
 *
 * Below the budget the segments still exceed the row if the bare model alone is too wide. This
 * function only guarantees that ADDING the provider cannot be what pushes the line over; what
 * happens to a row the bare segments themselves overflow is `statusBarRow`'s and the render's.
 */
export function statusBarSegments(input: {
  mode: string;
  modelDisplayName?: string;
  modelProviderType?: string;
  turnCount?: number;
  /**
   * Columns already spoken for by a sibling `<Text>` on this same line (the approvals badge). It
   * is a separate node so it can carry its own colour, but the terminal wraps the row as a whole,
   * so the budget has to know about it. The debug hint is deliberately NOT reserved: it takes
   * what is left (`statusBarRow`).
   */
  reservedColumns?: number;
  /** Live `stdout.columns`; `undefined` (non-TTY / tests) falls back to 80, as `ruleWidth` does. */
  columns?: number;
}): string {
  const columns = resolveColumns(input.columns);
  const budget = columns - (input.reservedColumns ?? 0);

  const build = (modelSegment: string | null): string =>
    [input.mode, modelSegment, `turns: ${input.turnCount ?? 0}`, 'ready']
      .filter(Boolean)
      .join(SEPARATOR);

  const model = input.modelDisplayName?.trim();
  if (!model) return build(null);

  // The shared `model (provider)` spelling (DL-6) — never a second local template.
  const withProvider = build(`model: ${modelProviderLabel(model, input.modelProviderType)}`);
  // Nothing to drop when no provider resolved: the label is already the bare model.
  if (!input.modelProviderType?.trim()) return withProvider;
  return displayWidth(withProvider) <= budget ? withProvider : build(`model: ${model}`);
}

/** The approvals posture the bar shows, and the profile the rated rungs name beside it. */
export interface StatusBarApprovals {
  rung: ApprovalRung;
  raterProfile?: string;
}

/**
 * The two spellings of the approvals badge: `full` names the rater profile beside a rated rung,
 * `short` does not. The same string twice for `bypass` and the unrated rungs, which have no
 * profile to name.
 *
 * CFG-26 — the badge is the RESOLVED posture, surfaced persistently so the user always knows how
 * tool calls are being handled. It renders the MODE, never a boolean: a boolean seeded from the
 * bypass flag read `false` while a rated rung was approving safe commands with no prompt, and a
 * safety indicator that under-reports is worse than none, so the badge is shown at EVERY rung and
 * names it. §10 rule 4: the display spelling, never the kebab-case identifier.
 */
export function approvalsBadgeSpellings(
  approvals: StatusBarApprovals | undefined
): { full: string; short: string } | undefined {
  if (!approvals) return undefined;
  if (approvals.rung === 'bypass') return { full: ' ⚡ Bypass', short: ' ⚡ Bypass' };
  const short = `${SEPARATOR}approvals: ${APPROVAL_RUNG_LABELS[approvals.rung]}`;
  const full = isRatedRung(approvals.rung)
    ? `${short} (${approvals.raterProfile ?? 'auto-rater'})`
    : short;
  return { full, short };
}

/** The texts the bar's row is drawn from: the dim segment run, the badge and the hint if drawn. */
export interface StatusBarRow {
  segments: string;
  badge?: string;
  /** The debug hint as drawn — whole, clipped to the room left with `…`, or absent (no room). */
  hint?: string;
}

/**
 * TUI-C92 — the whole idle row's texts at `columns`, chosen so the row fits ONE row.
 *
 * The status bar is a single line by rule (DL-7, `maintenance/ux-guidelines.md`), and the dock's
 * row budget in `App.tsx` counts it as one. The order of sacrifice when it will not fit, least
 * informative first:
 *
 * 1. the provider — `statusBarSegments`'s decision, with the badge reserved and the debug hint
 *    NOT reserved, so the same width arithmetic makes every step;
 * 2. the rater profile on the badge — `approvals: Assisted (auto-rater)` becomes
 *    `approvals: Assisted`;
 * 3. the debug hint, when it is drawn: it gets only the room the segments and the badge leave it
 *    — clipped with `…`, or not drawn at all (`hintAsDrawn`) — and neither step above reserves a
 *    cell for it, so it is the first thing on the row to give way at every rung, before the
 *    profile and before the provider. It is the least informative element there, and this step
 *    is arithmetic because a layout engine cannot put one sibling first;
 * 4. only then truncation with `…` at the row's end, which is the RENDER's: every `<Text>` on the
 *    row is `wrap="truncate-end"`, and exactly one part of the row refuses to shrink. At every
 *    rung but `bypass` that part is the segments, and the badge gives way first. At `bypass` it is
 *    the badge, and the segments' tail gives way instead: `⚡ Bypass` is the one badge whose
 *    absence misreports a posture with no gate at all, so it holds whole while `ready`, then the
 *    turn counter and — below the width that holds mode + model + the `…` the clipped segments
 *    end in + badge — the model itself are clipped. That step is by construction rather than by
 *    arithmetic, which is what makes the one-row count true at a width narrower than the segments
 *    themselves.
 *
 * So the row's priority, highest first: the badge (`bypass` only) → the model → the rest of the
 * segments → the badge (every other rung) → the hint.
 *
 * So the strings returned here can still be wider than the row together; what this function
 * promises is that the least is sacrificed that the arithmetic can tell will fit, and that the
 * choice is made here, in a pure function a spec can drive, not in JSX.
 */
export function statusBarRow(input: {
  mode: string;
  modelDisplayName?: string;
  modelProviderType?: string;
  turnCount?: number;
  columns?: number;
  debugHint?: boolean;
  approvals?: StatusBarApprovals;
}): StatusBarRow {
  const columns = resolveColumns(input.columns);
  const spellings = approvalsBadgeSpellings(input.approvals);
  const full = spellings?.full ?? '';
  // Neither drop sees the hint: it ranks below the provider and the profile, so reserving its
  // width here would sacrifice one of them to keep a hint the row then clips anyway.
  const segments = statusBarSegments({
    mode: input.mode,
    modelDisplayName: input.modelDisplayName,
    modelProviderType: input.modelProviderType,
    turnCount: input.turnCount,
    reservedColumns: displayWidth(full),
    columns,
  });
  const row: StatusBarRow = { segments };
  if (spellings) {
    const fullFits = displayWidth(segments) + displayWidth(full) <= columns;
    row.badge = fullFits ? full : spellings.short;
  }
  if (input.debugHint) {
    const hint = hintAsDrawn(columns - displayWidth(segments) - displayWidth(row.badge ?? ''));
    if (hint !== undefined) row.hint = hint;
  }
  return row;
}

/**
 * Session status bar. While a turn is running it shows a spinner + interrupt hint;
 * otherwise it surfaces useful session context — the mode, the model and the provider serving it,
 * and a turn counter — on a single dim line. Streaming progress itself is shown by the live
 * turn, not here, so this bar stays stable (one line) and does not flicker.
 *
 * **One row by construction, in both states.** The dock's row budget counts this bar as one row,
 * so it cannot be allowed to wrap at any width: every `<Text>` on the row truncates with `…`
 * instead of wrapping (DL-7), and one part of the row sits in a `flexShrink={0}` box so that the
 * rest gives way to it. That part is the leading text — so the badge, not the model, is what
 * shrinks — except at `bypass`, where it is the `⚡ Bypass` badge and the leading text's tail
 * shrinks instead: a badge clipped to `⚡ …` would hide the one posture with no gate at all. The
 * debug hint gives way before either: `statusBarRow` clips it to the room left, or leaves it out,
 * so it is never in an overflowing row. Which spelling of the badge is drawn, and how much of the
 * hint, is `statusBarRow`'s decision.
 */
export function StatusBar({
  running,
  mode,
  modelDisplayName,
  modelProviderType,
  turnCount,
  debugHint,
  approvals,
  columns,
}: {
  running: boolean;
  mode: string;
  modelDisplayName?: string;
  /**
   * CFG-38 — `config.modelProviderType`, rendered as `model: <model> (<provider>)`. Absent for a
   * module config (which hands the loader an already-built model), and dropped on a terminal too
   * narrow to carry it — see `statusBarSegments`.
   */
  modelProviderType?: string;
  /** Live terminal width, for the row's fit decisions. Unknown falls back to 80 columns. */
  columns?: number;
  turnCount?: number;
  /** When the docked debug panel is open but unfocused, surface how to step into it. */
  debugHint?: boolean;
  /**
   * CFG-26 — the RESOLVED approvals posture, as a persistent badge; see
   * `approvalsBadgeSpellings` for why it is shown at every rung. Undefined = this session has no
   * approvals surface (fixture agent / non-shell); the badge is omitted rather than guessing a rung.
   */
  approvals?: StatusBarApprovals;
}): React.ReactElement {
  // The badge's spelling is decided on the idle row in both states, so it does not change wording
  // as a turn starts and stops. Truncation at the render keeps the running row one row too.
  const row = statusBarRow({
    mode,
    modelDisplayName,
    modelProviderType,
    turnCount,
    columns,
    debugHint,
    approvals,
  });

  // A single, always-visible badge (next to the spinner while running, in the status line when
  // idle). Only `bypass` is warn-styled: it is the one rung with NO gate at all. The rest are dim
  // like the rest of the status line — `assisted` is the default and recommended posture, and
  // shouting at the user about the default trains them to ignore the colour that matters.
  //
  // `bypass` is also the one badge that never gives way: its box refuses to shrink, and the
  // leading text — the segments when idle, the interrupt hint while running — is what truncates
  // instead. Every other badge shrinks first, and the leading text is what holds.
  const badgeHolds = approvals?.rung === 'bypass';
  const approvalsBadge =
    row.badge === undefined ? null : badgeHolds ? (
      <Box flexShrink={0}>
        <Text color="yellow" bold wrap="truncate-end">
          {row.badge}
        </Text>
      </Box>
    ) : (
      <Text dimColor wrap="truncate-end">
        {row.badge}
      </Text>
    );

  if (running) {
    return (
      <Box>
        <Box flexShrink={badgeHolds ? 1 : 0}>
          <Text color="yellow" wrap="truncate-end">
            <Spinner type="dots" /> Thinking… (Esc to interrupt)
          </Text>
        </Box>
        {approvalsBadge}
      </Box>
    );
  }

  return (
    <Box>
      <Box flexShrink={badgeHolds ? 1 : 0}>
        <Text dimColor wrap="truncate-end">
          {row.segments}
        </Text>
      </Box>
      {approvalsBadge}
      {row.hint === undefined ? null : (
        <Text dimColor wrap="truncate-end">
          {row.hint}
        </Text>
      )}
    </Box>
  );
}
