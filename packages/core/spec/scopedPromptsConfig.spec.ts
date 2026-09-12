import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  formatConfigValidationError,
  rawGthConfigSchema,
  validateRawGthConfig,
} from '#src/config/schema.js';

/**
 * CFG-70 — `prompts.paths` as a CONFIG key: that it survives the schema, that the keys a scoped
 * entry refuses are refused loudly, and that the list replaces rather than accumulates across
 * config layers.
 */
const scopedEntry = {
  name: 'vue-ui',
  match: ['packages/vue-ui/**'],
  guidelines: '.gsloth/guidelines/vue-ui.md',
};

describe('CFG-70 prompts.paths: the schema keeps it', () => {
  it('survives a schema round-trip rather than being stripped', () => {
    // promptsSchema is a plain z.object, so an undeclared sibling key is dropped SILENTLY — the
    // config would load, the feature would do nothing, and nothing would say so. This asserts the
    // PARSED output, never the input object, which would pass with `paths` undeclared.
    const parsed = rawGthConfigSchema.safeParse({
      llm: { type: 'anthropic' },
      prompts: { guidelines: 'AGENTS.md', paths: [scopedEntry] },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const prompts = parsed.data.prompts as Record<string, unknown> | undefined;
    expect(prompts?.paths).toEqual([scopedEntry]);
    expect(prompts?.guidelines).toBe('AGENTS.md');
  });

  it('accepts every prompt segment name as a plain string path', () => {
    const parsed = rawGthConfigSchema.safeParse({
      llm: { type: 'anthropic' },
      prompts: {
        paths: [
          {
            name: 'everything',
            match: ['src/**'],
            backstory: 'b.md',
            guidelines: 'g.md',
            system: 's.md',
            chat: 'c.md',
            code: 'co.md',
            exec: 'e.md',
            review: 'r.md',
          },
        ],
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a segment written as the top-level object form', () => {
    // Inside a scoped entry a segment is a bare path; the `{ path }` object belongs to the root.
    const result = validateRawGthConfig({
      llm: { type: 'anthropic' },
      prompts: { paths: [{ name: 'vue-ui', match: ['x/**'], guidelines: { path: 'g.md' } }] },
    });
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toContain('prompts.paths.0.guidelines');
  });
});

describe('CFG-70 prompts.paths: mode and enabled are rejected, not ignored', () => {
  it('rejects `mode`, naming the entry and saying scoped entries always append', () => {
    const result = validateRawGthConfig({
      llm: { type: 'anthropic' },
      prompts: {
        paths: [scopedEntry, { name: 'adk', match: ['packages/adk/**'], mode: 'replace' }],
      },
    });
    expect(result.ok).toBe(false);
    // The issue path gives an index; the user needs the entry they wrote.
    expect(result.errorMessage).toContain('"adk"');
    expect(result.errorMessage).toContain('mode');
    expect(result.errorMessage?.toLowerCase()).toContain('append');
  });

  it('rejects `enabled` the same way', () => {
    const result = validateRawGthConfig({
      llm: { type: 'anthropic' },
      prompts: { paths: [{ name: 'adk', match: ['packages/adk/**'], enabled: false }] },
    });
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toContain('"adk"');
    expect(result.errorMessage).toContain('enabled');
  });

  it('names an unnamed entry generically rather than printing undefined', () => {
    const parsed = rawGthConfigSchema.safeParse({
      llm: { type: 'anthropic' },
      prompts: { paths: [{ match: ['x/**'], mode: 'replace' }] },
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const message = formatConfigValidationError(parsed.error);
    // Scoped to the rejection line: the same error report also carries zod's own "received
    // undefined" for the missing name, which is correct and not what this pins.
    const rejection = message.split('\n').find((line) => line.includes('scoped prompt entry'));
    expect(rejection).toBeDefined();
    expect(rejection).toContain('A scoped prompt entry');
    expect(rejection).not.toContain('undefined');
  });

  it('leaves zod to word a child issue — only the unrecognized key is re-phrased', () => {
    // The schema-level error hook also sees `invalid_type`; a hook that answered every issue would
    // replace zod's accurate "expected object" with a sentence about mode and enabled.
    const parsed = rawGthConfigSchema.safeParse({
      llm: { type: 'anthropic' },
      prompts: { paths: ['not-an-object'] },
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const message = formatConfigValidationError(parsed.error);
    expect(message).toContain('expected object');
    expect(message).not.toContain('always APPENDS');
  });
});

describe('CFG-70 prompts.paths: name and match are required and non-empty', () => {
  it('rejects an entry with no name', () => {
    const result = validateRawGthConfig({
      llm: { type: 'anthropic' },
      prompts: { paths: [{ match: ['packages/adk/**'] }] },
    });
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toContain('prompts.paths.0.name');
  });

  it('rejects an empty name', () => {
    const result = validateRawGthConfig({
      llm: { type: 'anthropic' },
      prompts: { paths: [{ name: '', match: ['packages/adk/**'] }] },
    });
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toContain('prompts.paths.0.name');
  });

  it('rejects a missing, empty, or blank-patterned match list', () => {
    const missing = validateRawGthConfig({
      llm: { type: 'anthropic' },
      prompts: { paths: [{ name: 'adk' }] },
    });
    expect(missing.ok).toBe(false);
    expect(missing.errorMessage).toContain('prompts.paths.0.match');

    const empty = validateRawGthConfig({
      llm: { type: 'anthropic' },
      prompts: { paths: [{ name: 'adk', match: [] }] },
    });
    expect(empty.ok).toBe(false);
    expect(empty.errorMessage).toContain('prompts.paths.0.match');

    const blank = validateRawGthConfig({
      llm: { type: 'anthropic' },
      prompts: { paths: [{ name: 'adk', match: [''] }] },
    });
    expect(blank.ok).toBe(false);
    expect(blank.errorMessage).toContain('prompts.paths.0.match.0');
  });
});

/**
 * The layering cell runs the REAL loader over real files on disk, with only the home directory
 * faked, because the merge rule being pinned lives in `deepMerge` and is reached through
 * `applyGlobalConfigBase` — a hand-rolled merge in the spec would assert a reimplementation.
 */
const consoleUtilsMock = {
  display: vi.fn(),
  displayError: vi.fn(),
  displayInfo: vi.fn(),
  displayWarning: vi.fn(),
  displaySuccess: vi.fn(),
  displayDebug: vi.fn(),
  setConsoleLevel: vi.fn(),
};
vi.mock('#src/utils/consoleUtils.js', () => consoleUtilsMock);

let mockProjectDir: string | undefined = undefined;
let mockCwd = '';

vi.mock('#src/utils/systemUtils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#src/utils/systemUtils.js')>();
  return {
    ...actual,
    getCurrentWorkDir: () => mockCwd,
    getProjectDir: () => mockProjectDir ?? mockCwd,
    setProjectDir: (dir: string | undefined) => {
      mockProjectDir = dir;
    },
    isTTY: () => true,
    isStdoutTTY: () => true,
  };
});

const homeDirMock = { dir: '' };
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => homeDirMock.dir };
});

describe('CFG-70 prompts.paths: a project list REPLACES a global list', () => {
  let projectRoot: string;
  let homeRoot: string;
  let globalRoot: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProjectDir = undefined;
    projectRoot = mkdtempSync(resolve(tmpdir(), 'gsloth-cfg70-project-'));
    homeRoot = mkdtempSync(resolve(tmpdir(), 'gsloth-cfg70-home-'));
    mockCwd = projectRoot;
    homeDirMock.dir = homeRoot;
    globalRoot = resolve(homeRoot, '.gsloth');
    mkdirSync(globalRoot, { recursive: true });
    mkdirSync(resolve(projectRoot, '.git'), { recursive: true });

    vi.doMock('#src/providers/vertexai.js', () => ({
      processJsonConfig: vi.fn().mockImplementation((llm: Record<string, unknown>) => ({
        type: 'vertexai',
        ...llm,
      })),
      postProcessJsonConfig: undefined,
    }));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(homeRoot, { recursive: true, force: true });
  });

  it('does not concatenate the two layers', async () => {
    // `prompts.paths` stays on deepMerge's array DEFAULT — adding it to isAdditiveArrayField is a
    // tempting one-line "fix" that would silently attach a global entry to every project.
    writeFileSync(
      resolve(globalRoot, '.gsloth.config.json'),
      JSON.stringify({
        llm: { type: 'vertexai', model: 'global-model' },
        prompts: {
          guidelines: 'GLOBAL.md',
          paths: [{ name: 'global-only', match: ['**'], guidelines: 'global-scoped.md' }],
        },
      })
    );
    writeFileSync(
      resolve(projectRoot, '.gsloth.config.json'),
      JSON.stringify({
        llm: { type: 'vertexai', model: 'project-model' },
        prompts: {
          paths: [{ name: 'project-only', match: ['src/**'], guidelines: 'project-scoped.md' }],
        },
      })
    );

    const { initConfig } = await import('#src/config.js');
    const config = await initConfig({});

    expect(config.prompts?.paths?.map((entry) => entry.name)).toEqual(['project-only']);
    // The sibling key still merges field-wise — this is an array rule, not a whole-block override,
    // so a cell asserting only the array would pass for a merge that clobbered all of `prompts`.
    expect(config.prompts?.guidelines).toBe('GLOBAL.md');
  });

  it('inherits the global list when the project declares none', async () => {
    writeFileSync(
      resolve(globalRoot, '.gsloth.config.json'),
      JSON.stringify({
        llm: { type: 'vertexai', model: 'global-model' },
        prompts: { paths: [{ name: 'global-only', match: ['**'], guidelines: 'g.md' }] },
      })
    );
    writeFileSync(
      resolve(projectRoot, '.gsloth.config.json'),
      JSON.stringify({ llm: { type: 'vertexai', model: 'project-model' } })
    );

    const { initConfig } = await import('#src/config.js');
    const config = await initConfig({});

    expect(config.prompts?.paths?.map((entry) => entry.name)).toEqual(['global-only']);
  });
});
