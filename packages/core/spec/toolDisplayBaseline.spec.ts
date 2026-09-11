import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Same posture as toolDisplay.spec.ts: an empty env plus explicit `[]` secrets per call, so the
// control measures the renderer and not this machine.
const systemUtilsMock = {
  env: {} as Record<string, string | undefined>,
};
vi.mock('#src/utils/systemUtils.js', () => systemUtilsMock);

const here = dirname(fileURLToPath(import.meta.url));

interface BaselineEntry {
  id: string;
  input: { name: string; argsText?: string; output?: string; result?: string; isError?: boolean };
  glyph: string;
  summary: string;
  preview: Array<{ text: string; style: string }>;
}

const baseline = JSON.parse(
  readFileSync(resolve(here, 'fixtures/toolDisplayBaseline.json'), 'utf8')
) as { entries: BaselineEntry[] };

/**
 * [[TUI-C105]] — THE CONTROL for the configurable preview depth.
 *
 * The risk in making the depth configurable is silently moving DEFAULT rendering, so this replays a
 * corpus covering every name in the display registry (plus an unregistered generic tool, an
 * unregistered shell-shaped one, and the unparsable/no-args frames) and asserts the rendering is
 * byte-identical to what the PRE-CHANGE build produced.
 *
 * **The fixture is frozen evidence, not an expectation to refresh.** It was captured from the build
 * of the commit before the implementation — `packages/core/scripts/capture-tool-display-baseline.mjs`,
 * committed on its own so the ordering is checkable in git rather than merely asserted. Regenerating
 * it from the current build would turn every case below into an assertion that cannot fail.
 *
 * ONE delta is expected, and it is declared here rather than tolerated: `gth_gh_read_file` gains a
 * registry entry, which changes its GLYPH from the generic `⚙` to `📁`. Its summary line and its
 * body do NOT change — the generic fallback already summarised every parsed argument, so a tracked
 * call always rendered `gth_gh_read_file(path=…)` with or without a registry entry. Anything else
 * moving is a regression.
 */
describe('toolDisplay default rendering — control against the pre-change build (TUI-C105)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    systemUtilsMock.env = {};
  });

  /** Entries whose GLYPH is allowed to move, and what it must move to. */
  const EXPECTED_GLYPH_CHANGES: Record<string, string> = {
    gth_gh_read_file: '📁',
    'gth_gh_read_file-error': '📁',
  };

  it('covers the whole corpus that was captured (the fixture is not silently empty)', () => {
    expect(baseline.entries.length).toBeGreaterThanOrEqual(25);
    for (const name of ['read_file', 'write_file', 'edit_file', 'run_shell_command', 'task']) {
      expect(baseline.entries.some((e) => e.input.name === name)).toBe(true);
    }
  });

  it.each(baseline.entries.map((e) => [e.id, e] as const))(
    'renders %s exactly as the pre-change build did, with no configuration',
    async (_id, entry) => {
      const { summariseToolCall, buildToolPreviewLines, getToolGlyph } =
        await import('#src/core/toolDisplay.js');

      // No `setToolDisplayConfig` call at all: this is the unconfigured session the control is about.
      expect(summariseToolCall(entry.input.name, entry.input.argsText, [])).toBe(entry.summary);
      expect(buildToolPreviewLines(entry.input, [])).toEqual(entry.preview);

      const expectedGlyph = EXPECTED_GLYPH_CHANGES[entry.id] ?? entry.glyph;
      expect(getToolGlyph(entry.input.name)).toBe(expectedGlyph);
    }
  );

  it('the declared glyph exception is real — those entries did NOT render 📁 before', () => {
    // Guards the exception list from quietly growing into a place where a regression can hide: an
    // entry may only be listed if the baseline shows it changing.
    for (const [id, glyph] of Object.entries(EXPECTED_GLYPH_CHANGES)) {
      const entry = baseline.entries.find((e) => e.id === id);
      expect(entry, `no baseline entry named ${id}`).toBeDefined();
      expect(entry!.glyph).not.toBe(glyph);
    }
  });

  it('the registry entry did NOT change the summary line — the file was already named', () => {
    // Worth pinning as its own case: the node was written expecting `gth_gh_read_file()` to become
    // `gth_gh_read_file(path=…)`. It was already the latter whenever the call's arguments reached
    // the display layer, because the generic fallback summarises every parsed argument. An empty
    // `gth_gh_read_file()` in a real run means the arguments were never tracked, which a registry
    // entry cannot fix — see the residual case in plainToolIndication.spec.ts.
    const entry = baseline.entries.find((e) => e.id === 'gth_gh_read_file')!;
    expect(entry.summary).toBe('gth_gh_read_file(path=packages/core/src/core/toolDisplay.ts)');
  });
});
