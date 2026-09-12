import { beforeEach, describe, expect, it, vi } from 'vitest';

// Empty env + explicit secrets per call, matching toolDisplay.spec.ts, so nothing here depends on
// the machine it runs on.
const systemUtilsMock = {
  env: {} as Record<string, string | undefined>,
};
vi.mock('#src/utils/systemUtils.js', () => systemUtilsMock);

/** A result comfortably longer than any depth under test. */
const TWELVE_LINES = Array.from({ length: 12 }, (_, i) => `body-${i + 1}`).join('\n');

/**
 * [[TUI-C105]] — the CONFIGURABLE tool-output preview depth.
 *
 * Resolution order, which is what most of this file pins:
 * **`builtInTools.<tool>.previewLines` → root `toolOutputPreviewLines` → `TOOL_OUTPUT_PREVIEW_LINES`.**
 *
 * The per-tool override rides the `builtInTools` registry (CFG-18's single per-tool surface) and so
 * layers per command exactly as `maxBytes` does; the global default is a root key because the issue
 * this came from asks for less tool-output noise generally.
 */
describe('tool-output preview depth (TUI-C105)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    systemUtilsMock.env = {};
  });

  const load = async () => import('#src/core/toolDisplay.js');
  const readFile = { name: 'read_file', argsText: '{"path":"a.ts"}', result: TWELVE_LINES };

  describe('with nothing configured, the built-in cap still applies', () => {
    // Three shapes of "no configuration", because the PTY e2e gate and every existing spec run in
    // one of them: a session where setToolDisplayConfig was never called, one handed a config with
    // no display keys, and one handed a config with a `commands` block that says nothing about this.
    it('renders the canonical cap when no config was ever registered', async () => {
      const { buildToolPreviewLines, TOOL_OUTPUT_PREVIEW_LINES } = await load();
      const preview = buildToolPreviewLines(readFile, []);
      expect(TOOL_OUTPUT_PREVIEW_LINES).toBe(10);
      expect(preview).toHaveLength(TOOL_OUTPUT_PREVIEW_LINES + 1); // + the overflow marker
      expect(preview[preview.length - 1].text).toBe('… (+2 more lines)');
    });

    it('renders the canonical cap for a config carrying no display keys', async () => {
      const { buildToolPreviewLines, setToolDisplayConfig } = await load();
      setToolDisplayConfig({ llm: { type: 'vertexai' } }, 'review');
      expect(buildToolPreviewLines(readFile, [])).toHaveLength(11);
    });

    it('renders the canonical cap for a config whose commands say nothing about this', async () => {
      const { buildToolPreviewLines, setToolDisplayConfig } = await load();
      setToolDisplayConfig({ commands: { review: { contentSource: 'gh' } } }, 'review');
      expect(buildToolPreviewLines(readFile, [])).toHaveLength(11);
    });
  });

  describe('the global default', () => {
    it('caps the body at N lines plus the existing overflow marker', async () => {
      const { buildToolPreviewLines, setToolDisplayConfig } = await load();
      setToolDisplayConfig({ toolOutputPreviewLines: 3 });
      const preview = buildToolPreviewLines(readFile, []);
      expect(preview.map((l) => l.text)).toEqual([
        'body-1',
        'body-2',
        'body-3',
        '… (+9 more lines)',
      ]);
    });

    it('applies to every tool, not only the review file-reader', async () => {
      const { buildToolPreviewLines, setToolDisplayConfig } = await load();
      setToolDisplayConfig({ toolOutputPreviewLines: 2 });
      for (const name of ['read_file', 'list_directory', 'some_unregistered_mcp_tool']) {
        const preview = buildToolPreviewLines({ name, result: TWELVE_LINES }, []);
        expect(preview.map((l) => l.text).slice(0, 2)).toEqual(['body-1', 'body-2']);
        expect(preview).toHaveLength(3);
      }
    });

    it('falls back to the canonical cap for a negative, non-finite or non-numeric value', async () => {
      for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, '4', null]) {
        const mod = await load();
        mod.setToolDisplayConfig({ toolOutputPreviewLines: bad });
        expect(mod.buildToolPreviewLines(readFile, []), `value ${String(bad)}`).toHaveLength(11);
      }
    });
  });

  describe('the per-tool override', () => {
    it('outranks the global default for the tool it names, leaving others on the default', async () => {
      const { buildToolPreviewLines, setToolDisplayConfig } = await load();
      setToolDisplayConfig({
        toolOutputPreviewLines: 5,
        builtInTools: { gth_gh_read_file: { previewLines: 1 } },
      });
      expect(
        buildToolPreviewLines({ name: 'gth_gh_read_file', result: TWELVE_LINES }, [])
      ).toHaveLength(2);
      expect(buildToolPreviewLines(readFile, [])).toHaveLength(6);
    });

    it('accepts 0 — the guard is >= 0, not the > 0 a byte cap uses', async () => {
      // `maxBytes` rejects 0 because a zero byte budget would mean "return nothing to the model".
      // Zero PREVIEW lines is the whole point of this setting, so copying that guard would reject
      // the one value the node exists to provide.
      const { buildToolPreviewLines, setToolDisplayConfig } = await load();
      setToolDisplayConfig({ builtInTools: { read_file: { previewLines: 0 } } });
      expect(buildToolPreviewLines(readFile, [])).toEqual([]);
    });

    it('layers per command, like every other builtInTools entry', async () => {
      const { buildToolPreviewLines, setToolDisplayConfig } = await load();
      const config = {
        builtInTools: { gth_gh_read_file: { previewLines: 4 } },
        commands: { review: { builtInTools: { gth_gh_read_file: { previewLines: 0 } } } },
      };
      const call = { name: 'gth_gh_read_file', result: TWELVE_LINES };

      setToolDisplayConfig(config, 'review');
      expect(buildToolPreviewLines(call, [])).toEqual([]);

      setToolDisplayConfig(config, 'pr');
      expect(buildToolPreviewLines(call, [])).toHaveLength(5);
    });

    it('reads the root registry when no command is registered', async () => {
      const { buildToolPreviewLines, setToolDisplayConfig } = await load();
      setToolDisplayConfig({ builtInTools: { read_file: { previewLines: 2 } } });
      expect(buildToolPreviewLines(readFile, [])).toHaveLength(3);
    });

    it('falls back rather than throwing when the registered config is not an object', async () => {
      const { buildToolPreviewLines, setToolDisplayConfig } = await load();
      setToolDisplayConfig('not a config at all');
      expect(buildToolPreviewLines(readFile, [])).toHaveLength(11);
    });
  });

  describe('depth 0 — the summary line alone', () => {
    it('emits NO body lines and, deliberately, no overflow marker either', async () => {
      // The marker serves DL-4 (say how much was hidden). At an explicitly requested depth of 0 it
      // would defeat the setting: the user asked for one line and would get two. This is the local
      // exception, and it is the assertion that stops the feature being quietly half-built.
      const { buildToolPreviewLines, setToolDisplayConfig } = await load();
      setToolDisplayConfig({ toolOutputPreviewLines: 0 });
      const preview = buildToolPreviewLines(readFile, []);
      expect(preview).toEqual([]);
      expect(preview.some((l) => l.text.includes('more line'))).toBe(false);
    });

    it('leaves a gth_gh_read_file call as ONE line that NAMES THE FILE', async () => {
      // Acceptance 2. The filename is asserted, not merely the line count: a test that counted
      // lines alone would pass on the useless version of this feature, where the surviving line
      // says nothing about what was read.
      const { buildToolPreviewLines, summariseToolCall, setToolDisplayConfig } = await load();
      setToolDisplayConfig({ builtInTools: { gth_gh_read_file: { previewLines: 0 } } });

      const argsText = '{"path":"src/tenant/Community.ts"}';
      const result = `Full contents of acme/widgets/src/tenant/Community.ts@main:\n\n${TWELVE_LINES}`;
      const summary = summariseToolCall('gth_gh_read_file', argsText, []);
      const body = buildToolPreviewLines({ name: 'gth_gh_read_file', argsText, result }, []);

      expect(body).toEqual([]);
      expect(summary).toContain('src/tenant/Community.ts');
      expect([summary, ...body.map((l) => l.text)]).toHaveLength(1);
    });

    /*
     * [[TUI-C105]]'s labelled residual — a call whose arguments never reached this layer, whose one
     * surviving line at depth 0 then named nothing — USED TO BE ASSERTED HERE, and deliberately is
     * not any more.
     *
     * [[TUI-C106]] found why those arguments went missing, and it is not a rendering question at
     * all: they were accumulated correctly and then discarded when the turn crossed a
     * `streamFromInput` boundary at an approval gate. Nothing this module could assert would have
     * caught that, and a residual pinned here would go on passing while the defect was live.
     *
     * **It is pinned in `packages/core/spec/plainToolIndicationAcrossResume.spec.ts` instead**,
     * which drives the real agent across the real `stream()` → `streamResume()` pair and fails
     * with exactly the row issue #445 reported. That is the residual's real home: the cell that
     * reproduces the defect rather than the one that renders its symptom.
     */
  });

  /**
   * [[TUI-C108]] — the floor is the second exception to the configured depth, and it lives beside
   * the depth-0 one because the two have to be read together: a call that did not work is not a
   * tool call occupying a block, it is the reason the run is about to go wrong.
   *
   * These cells are on `buildToolPreviewLines` rather than on either surface deliberately — BOTH
   * surfaces call it, and the floor is meant to reach both.
   */
  describe('a FAILED call floors the depth, whatever was configured', () => {
    const failed = {
      name: 'read_file',
      argsText: '{"path":"a.ts"}',
      result: TWELVE_LINES,
      isError: true,
    };

    it('keeps the floor of error lines at depth 0, where a success gets nothing', async () => {
      const { buildToolPreviewLines, setToolDisplayConfig, TOOL_ERROR_PREVIEW_FLOOR_LINES } =
        await load();
      setToolDisplayConfig({ toolOutputPreviewLines: 0 });

      const success = buildToolPreviewLines({ ...failed, isError: false }, []);
      const failure = buildToolPreviewLines(failed, []);

      // The contrast is the assertion: same depth, same result text, different outcome.
      expect(success).toEqual([]);
      expect(failure.length).toBeGreaterThanOrEqual(TOOL_ERROR_PREVIEW_FLOOR_LINES);
      // Asserted on the CONTENT, not the count: a floor that kept three lines of nothing would
      // satisfy a count and still withhold why the call failed.
      expect(failure.map((l) => l.text)).toContain('body-1');
    });

    it('floors a depth of 1 and 2 as well — the floor is not a depth-0 special case', async () => {
      for (const depth of [1, 2]) {
        vi.resetModules();
        const { buildToolPreviewLines, setToolDisplayConfig, TOOL_ERROR_PREVIEW_FLOOR_LINES } =
          await load();
        setToolDisplayConfig({ toolOutputPreviewLines: depth });
        const failure = buildToolPreviewLines(failed, []);
        // The overflow marker returns at any depth above 0, so the body is floor + marker.
        expect(failure.length).toBeGreaterThanOrEqual(TOOL_ERROR_PREVIEW_FLOOR_LINES);
        expect(failure.map((l) => l.text)).toContain('body-3');
      }
    });

    it('NEVER shortens a depth above the floor — the default 10 stays 10', async () => {
      const { buildToolPreviewLines } = await load();
      // Nothing registered: the canonical cap. A floor implemented as an assignment rather than a
      // Math.max would cut this to 3 and reds here.
      expect(buildToolPreviewLines(failed, [])).toHaveLength(11); // 10 + the overflow marker
    });

    it('leaves a SUCCESSFUL call at the configured depth', async () => {
      const { buildToolPreviewLines, setToolDisplayConfig } = await load();
      setToolDisplayConfig({ toolOutputPreviewLines: 1 });
      // The control for the cells above: the floor must key on the outcome, not fire for everyone.
      expect(buildToolPreviewLines(readFile, [])).toHaveLength(2); // 1 + the overflow marker
    });
  });

  describe('secret redaction survives every depth (TUI-C102 order is untouched)', () => {
    // Acceptance 4. The cap is step 3 of redact → neutralise → cap, and changing how many lines
    // survive must not change that the surviving text was redacted first. Both cases assert on the
    // FULL rendered output — summary plus body — because at depth 0 the body is empty and the
    // summary is the only thing left that could leak.
    const secret = 'inline-config-secret-value';
    const argsText = JSON.stringify({ path: 'a.ts', token: secret });
    const result = `${secret}\nbody-2\nbody-3\nbody-4`;

    it('redacts at depth 0, where the body it would have been found in is gone', async () => {
      const { buildToolPreviewLines, summariseToolCall, setToolDisplayConfig } = await load();
      setToolDisplayConfig({ toolOutputPreviewLines: 0 });
      const rendered = [
        summariseToolCall('some_tool', argsText, [secret]),
        ...buildToolPreviewLines({ name: 'some_tool', argsText, result }, [secret]).map(
          (l) => l.text
        ),
      ].join('\n');

      expect(rendered).not.toContain(secret);
      expect(rendered).toContain('<redacted>');
    });

    it('redacts at a custom depth', async () => {
      const { buildToolPreviewLines, summariseToolCall, setToolDisplayConfig } = await load();
      setToolDisplayConfig({ toolOutputPreviewLines: 2 });
      const body = buildToolPreviewLines({ name: 'some_tool', argsText, result }, [secret]);
      const rendered = [
        summariseToolCall('some_tool', argsText, [secret]),
        ...body.map((l) => l.text),
      ].join('\n');

      expect(body).toHaveLength(3); // 2 body lines + the overflow marker
      expect(rendered).not.toContain(secret);
      expect(body[0].text).toBe('<redacted>');
    });
  });

  describe('the registered command is dropped by the test reset', () => {
    it('does not leak a per-command depth into the next module load', async () => {
      const first = await load();
      first.setToolDisplayConfig(
        { commands: { review: { builtInTools: { read_file: { previewLines: 0 } } } } },
        'review'
      );
      expect(first.buildToolPreviewLines(readFile, [])).toEqual([]);

      first.resetToolDisplaySecretsCacheForTests();
      expect(first.buildToolPreviewLines(readFile, [])).toHaveLength(11);
    });
  });
});
