import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import chalk from 'chalk';
import stripAnsi from 'strip-ansi';
import {
  resetToolDisplaySecretsCacheForTests,
  setToolDisplayConfig,
} from '@gaunt-sloth/core/core/toolDisplay.js';
import { LiveTurn } from '#src/tui/components/LiveTurn.js';
import type { ToolCallViewModel, TurnViewModel } from '#src/tui/viewModel.js';

/**
 * [[TUI-C105]] — the configurable preview depth on the **Ink TUI** surface.
 *
 * TUI-C30 owns both render surfaces and the depth is resolved in the shared module they both call,
 * so a fix proven on one is not proven on the other. This is the TUI half; the plain/`--no-tui`
 * half — which is the surface `review` actually runs on — is in
 * `packages/core/spec/plainToolIndication.spec.ts`.
 */
const turnWith = (tool: ToolCallViewModel): TurnViewModel => ({
  isReasoning: false,
  segments: [{ kind: 'tool', tool }],
});

const TWELVE_LINES = Array.from({ length: 12 }, (_, i) => `body-${i + 1}`).join('\n');

const ghCall: ToolCallViewModel = {
  id: 't1',
  name: 'gth_gh_read_file',
  argsText: '{"path":"src/tenant/Community.ts"}',
  status: 'done',
  result: `Full contents of acme/widgets/src/tenant/Community.ts@main:\n\n${TWELVE_LINES}`,
};

describe('tui tool-call panel — configurable preview depth (TUI-C105)', () => {
  beforeEach(() => {
    chalk.level = 3;
    resetToolDisplaySecretsCacheForTests();
  });

  afterEach(() => {
    resetToolDisplaySecretsCacheForTests();
  });

  it('unconfigured, still previews the canonical 10 lines with the overflow marker', () => {
    const { lastFrame, unmount } = render(<LiveTurn turn={turnWith(ghCall)} columns={120} />);
    const f = stripAnsi(lastFrame() ?? '');
    expect(f).toContain('body-1');
    expect(f).toContain('body-8');
    expect(f).toContain('(+4 more lines)');
    unmount();
  });

  it('at depth 0 the panel collapses to a summary row that NAMES THE FILE', () => {
    setToolDisplayConfig({ builtInTools: { gth_gh_read_file: { previewLines: 0 } } });
    const { lastFrame, unmount } = render(<LiveTurn turn={turnWith(ghCall)} columns={120} />);
    const f = stripAnsi(lastFrame() ?? '');

    expect(f).toContain('src/tenant/Community.ts'); // the file is still named — acceptance 2
    expect(f).not.toContain('body-1'); // the body is gone
    expect(f).not.toContain('Full contents of'); // including the tool's own preamble line
    expect(f).not.toContain('more lines'); // and no overflow marker stands in for it
    unmount();
  });

  it('at a small depth the body is N lines plus the overflow marker', () => {
    setToolDisplayConfig({ toolOutputPreviewLines: 2 });
    const { lastFrame, unmount } = render(<LiveTurn turn={turnWith(ghCall)} columns={120} />);
    const f = stripAnsi(lastFrame() ?? '');

    // The tool's own preamble is line 1 of the result and is deliberately kept (it is the only
    // place the filename appears when a provider streams no tool-call id), so depth 2 shows it
    // plus the blank line that follows it, and the marker accounts for the rest.
    expect(f).toContain('Full contents of');
    expect(f).not.toContain('body-1');
    expect(f).toContain('(+12 more lines)');
    unmount();
  });

  it('gives the registered tool the file glyph rather than the generic one', () => {
    const { lastFrame, unmount } = render(<LiveTurn turn={turnWith(ghCall)} columns={120} />);
    expect(stripAnsi(lastFrame() ?? '')).toContain('📁');
    unmount();
  });
});
