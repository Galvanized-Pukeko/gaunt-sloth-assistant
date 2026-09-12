import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GthConfig } from '#src/config.js';
import type { GthCommand } from '#src/core/types.js';
import { StatusLevel } from '#src/core/types.js';

/**
 * CFG-70 — **telling a user that the verb they ran can never honour `prompts.paths`.**
 *
 * The failure this guards against is silent by construction: configure path-scoped prompts, run
 * `gth ask`, and the run is entirely ordinary with none of the scoped content in it. Nothing is
 * broken, nothing errors, and there is no way to tell from the output that a whole block of config
 * was inert.
 *
 * The warning lives in `getEffectiveConfig` rather than at config load because that is the single
 * funnel every verb passes through **holding its own verb**; `initConfig` takes
 * `CommandLineConfigOverrides`, which carries no verb at all, so the node's "warns at load, naming
 * the verb" could not be built where it says.
 *
 * Every cell here is a pair, because a one-sided assertion passes just as well against an
 * implementation that warns on everything or on nothing.
 */

const statusUpdate = vi.fn();

const baseConfig = (prompts?: unknown) =>
  ({
    llm: { bindTools: () => undefined },
    prompts,
  }) as unknown as GthConfig;

const WITH_PATHS = {
  paths: [{ name: 'vue-ui', match: ['packages/vue-ui/**'], guidelines: 'vue-ui.md' }],
};

async function effectiveConfigFor(command: GthCommand | undefined, prompts?: unknown) {
  const { GthLangChainAgent } = await import('#src/core/GthLangChainAgent.js');
  const agent = new GthLangChainAgent(statusUpdate);
  agent.getEffectiveConfig(baseConfig(prompts), command);
}

/** The warning this spec is about, isolated from the "model does not support tools" one. */
const scopedWarnings = () =>
  statusUpdate.mock.calls.filter(
    ([level, message]) => level === StatusLevel.WARNING && String(message).includes('prompts.paths')
  );

beforeEach(() => {
  statusUpdate.mockClear();
});

describe('getEffectiveConfig — the verb that cannot honour prompts.paths', () => {
  it('warns for a verb with no diff, naming that verb', async () => {
    await effectiveConfigFor('ask', WITH_PATHS);

    expect(scopedWarnings()).toHaveLength(1);
    const message = String(scopedWarnings()[0][1]);
    expect(message).toContain('ask');
    expect(message).toContain('prompts.paths');
    // The literal reassurance, so a user does not read this as "your prompts were dropped".
    expect(message).toContain('The root prompt segments still apply.');
  });

  it('stays silent for the two verbs that do honour it', async () => {
    await effectiveConfigFor('review', WITH_PATHS);
    await effectiveConfigFor('pr', WITH_PATHS);

    expect(scopedWarnings()).toHaveLength(0);
  });

  /**
   * `gth pr` discovery runs its agent commandless **on purpose** (GS2-81). An unguarded check
   * fires a spurious warning in the middle of the very verb that supports the feature best, which
   * is worse than saying nothing: it teaches a user that their working config is broken.
   */
  it('stays silent for a commandless agent init', async () => {
    await effectiveConfigFor(undefined, WITH_PATHS);

    expect(scopedWarnings()).toHaveLength(0);
  });

  it('stays silent for a diff-less verb when no entries are configured', async () => {
    await effectiveConfigFor('ask', {});
    await effectiveConfigFor('ask', { paths: [] });
    await effectiveConfigFor('ask', undefined);

    expect(scopedWarnings()).toHaveLength(0);
  });

  it('warns once per agent init rather than once per process', async () => {
    // Recorded rather than de-duplicated: a process that inits two agents ran two agents, and the
    // second is as unable to honour the config as the first. Suppressing the repeat would need
    // module-level state, which misbehaves across the several inits one `gth pr` performs.
    await effectiveConfigFor('code', WITH_PATHS);
    await effectiveConfigFor('code', WITH_PATHS);

    expect(scopedWarnings()).toHaveLength(2);
  });
});
