import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

/**
 * CFG-71 — a `.gsloth.config.js` exporting `configure()` must deliver a WORKING `llm`, by both
 * documented routes: a raw `{ type, model }` spec (which the loader has to route to a provider,
 * exactly as the JSON path does) and an already-built model instance (which has to survive the
 * global-config layer merge with its prototype, and therefore its methods, intact).
 *
 * **The global config is CONSTRUCTED here, not isolated away.** Both defects are only visible when a
 * global layer actually carries an `llm` block: with no global `llm` the merge takes its plain
 * override branch and a built instance passes through untouched. A spec that isolates `HOME` (or
 * otherwise arranges for there to be no global config) therefore cannot see the second defect at
 * all — it reports green on a broken loader. That blindness is why two careful measurements of this
 * bug disagreed, and it is the reason these cells write a real global config file.
 *
 * Hermetic and key-free: real `node:fs` under a temp dir, `INIT_CWD` drives the real up-tree
 * discovery walk, and the global config READ path is redirected into that same temp dir through the
 * production composition rule (`resolveGlobalConfigPath`). Nothing here reads or writes the real
 * `~/.gsloth` — the write-path helpers are stubbed to throw so a regression cannot quietly start.
 * Only the Anthropic SDK is mocked, so no provider ever needs a key or a network call.
 */
const hoisted = vi.hoisted(() => ({ globalDir: '' }));

/**
 * Stands in for a provider-built chat model: a CLASS, so `invoke` lives on the prototype and is
 * lost by any merge that spreads the instance into a plain object. That is precisely the failure
 * these cells pin, so a plain object with an own `invoke` property would be a vacuous stand-in.
 */
class FakeChatModel {
  readonly model: string;
  constructor(fields: { model?: string }) {
    this.model = fields.model ?? 'unset';
  }
  invoke(): string {
    return `invoked:${this.model}`;
  }
}

const ChatAnthropicMock = vi.fn(function ChatAnthropicMock(fields: { model?: string }) {
  return new FakeChatModel(fields);
});
vi.mock('@langchain/anthropic', () => ({ ChatAnthropic: ChatAnthropicMock }));

vi.mock('#src/utils/globalConfigUtils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#src/utils/globalConfigUtils.js')>();
  return {
    ...actual,
    // Only the DIR is redirected: the profile segment stays production code
    // (`resolveGlobalConfigPath`), so this seam cannot drift from the real composition rule.
    getGlobalGslothConfigReadPath: (filename: string, identityProfile?: string) =>
      actual.resolveGlobalConfigPath(hoisted.globalDir, filename, identityProfile),
    getGlobalGslothDir: () => hoisted.globalDir,
    // The read path is all this spec needs. The write helpers `mkdirSync` the REAL `~/.gsloth`, so
    // they are replaced with a throw rather than merely redirected: if a future change to the load
    // path starts calling one, this fails loudly here instead of touching the developer's own
    // configuration.
    ensureGlobalGslothDir: () => {
      throw new Error('CFG-71 spec must never create the global gsloth dir');
    },
    getGlobalGslothConfigWritePath: () => {
      throw new Error('CFG-71 spec must never resolve a global config WRITE path');
    },
  };
});

describe('CFG-71 — a module config must deliver a working llm', () => {
  let root: string;
  const origInitCwd = process.env.INIT_CWD;

  beforeEach(() => {
    root = mkdtempSync(resolve(tmpdir(), 'gsloth-cfg71-'));
    mkdirSync(resolve(root, '.git'), { recursive: true });
    hoisted.globalDir = resolve(root, 'globalhome');
    mkdirSync(hoisted.globalDir, { recursive: true });
    process.env.INIT_CWD = root;
    ChatAnthropicMock.mockClear();
  });

  afterEach(() => {
    if (origInitCwd === undefined) {
      delete process.env.INIT_CWD;
    } else {
      process.env.INIT_CWD = origInitCwd;
    }
    // One cell below `vi.doMock`s the anthropic provider. Undo it AND drop the module registry, or
    // it survives into every later cell in this file — which is how a provider stub silently became
    // the thing under test.
    vi.doUnmock('#src/providers/anthropic.js');
    vi.unstubAllEnvs();
    vi.resetModules();
    rmSync(root, { recursive: true, force: true });
  });

  /** Writes the global layer that makes the merge defect reachable. */
  const writeGlobalConfig = (config: Record<string, unknown>): void => {
    writeFileSync(resolve(hoisted.globalDir, '.gsloth.config.json'), JSON.stringify(config));
  };

  const writeProjectJsonConfig = (config: Record<string, unknown>): void => {
    writeFileSync(resolve(root, '.gsloth.config.json'), JSON.stringify(config));
  };

  const writeProjectModuleConfig = (body: string): void => {
    writeFileSync(resolve(root, '.gsloth.config.js'), body);
  };

  /**
   * A module config returning an already-built model. The class is declared INSIDE the config file
   * so the instance really is constructed by user code crossing the module boundary, as a user's
   * own `configure()` would build one.
   */
  const MODULE_CONFIG_RETURNING_INSTANCE = `
export async function configure() {
  class UserBuiltModel {
    constructor(model) {
      this.model = model;
    }
    invoke() {
      return 'invoked:' + this.model;
    }
  }
  return { llm: new UserBuiltModel('project-model'), streamOutput: true };
}
`;

  describe('mechanism 1 — a raw { type, model } spec returned from configure()', () => {
    it('routes to the provider and yields a callable model, as the JSON path does', async () => {
      // The documented raw-spec block, in the module format. Environment-independent: no global
      // config is involved in this defect at all.
      writeProjectModuleConfig(`
export async function configure() {
  return { llm: { type: 'anthropic', model: 'module-spec-model' }, streamOutput: true };
}
`);

      const { initConfig } = await import('#src/config.js');
      const config = await initConfig({});

      // The spec was ROUTED: the provider actually built something.
      expect(ChatAnthropicMock).toHaveBeenCalledTimes(1);
      expect(ChatAnthropicMock).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'module-spec-model' })
      );
      // ...and what came back is usable. Before CFG-71 this was the raw spec object: no `invoke`,
      // accepted at load time and fatal only at the first call.
      expect(typeof (config.llm as unknown as FakeChatModel).invoke).toBe('function');
      expect((config.llm as unknown as FakeChatModel).invoke()).toBe('invoked:module-spec-model');
      // Unrelated config from the same module still arrives, so routing did not replace the layer.
      expect(config.streamOutput).toBe(true);
    });

    it('routes the spec merged with the global layer, not the module layer on its own', async () => {
      // ROUTING ORDER — the decision the cell above cannot see, because there the module layer is
      // already the whole spec. `needsProviderRouting` is applied to the config AFTER
      // `applyGlobalConfigBase` underlays it, so a `type` living only in the global layer and a
      // `model` living only in the module layer build the model the user actually configured.
      //
      // Routing the composed module layer instead — moving the routing decision one line earlier —
      // refuses this exact configuration outright with "LLM type not specified in config.", and
      // drops the whole global layer from the routed path. Both halves are asserted below, because
      // the ordering is otherwise pinned by nothing at all.
      writeGlobalConfig({ llm: { type: 'anthropic' }, contentSource: 'text' });
      writeProjectModuleConfig(`
export async function configure() {
  return { llm: { model: 'module-only-model' } };
}
`);

      const { initConfig } = await import('#src/config.js');
      const config = await initConfig({});

      // The provider was handed BOTH layers: `type` exists only globally, `model` only in the
      // module, so neither layer alone could have produced this call.
      expect(ChatAnthropicMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'anthropic', model: 'module-only-model' })
      );
      expect((config.llm as unknown as FakeChatModel).invoke()).toBe('invoked:module-only-model');
      // ...and the rest of the global layer survived the routed path rather than being dropped on
      // the way through it. `contentSource` defaults to 'file', so a dropped layer fails loudly
      // here instead of silently reverting the user to a default they never asked for.
      expect(config.contentSource).toBe('text');
    });

    it('a provider with no API key raises catchably instead of falling through the formats', async () => {
      // Routing put the module path in reach of the provider layer, so it inherits the CFG-35
      // hazard the JSON path already guards: `tryModuleConfig`'s catch exists to move on to the
      // NEXT format, and a missing key is not a read failure. Without the re-raise this surfaces as
      // the terminal "No configuration file found" — blaming an absent config for a missing key,
      // which is the same silent-misdirection class this node is closing.
      writeProjectModuleConfig(`
export async function configure() {
  return { llm: { type: 'anthropic', model: 'module-spec-model' } };
}
`);
      // The key really is absent for the duration of this cell, so production's OWN classification
      // decides this is a missing key — it reads the environment, never the SDK's wording. Handing
      // it a ready-made `MissingProviderKeyError` would skip the step that has to work.
      vi.stubEnv('ANTHROPIC_API_KEY', '');
      vi.doMock('#src/providers/anthropic.js', () => ({
        // What a provider SDK does with no key: a plain, untyped throw.
        processJsonConfig: () => {
          throw new Error('Anthropic API key not found');
        },
        postProcessJsonConfig: undefined,
      }));

      const { initConfig, isMissingProviderKeyError } = await import('#src/config.js');
      const error = await initConfig({}).then(
        () => {
          throw new Error('expected a MissingProviderKeyError, but initConfig resolved');
        },
        (e: unknown) => e
      );

      // The TYPE is the assertion: a bare "it threw" would pass against the fall-through too,
      // which ends in a differently-worded throw about the config being absent.
      expect(isMissingProviderKeyError(error)).toBe(true);
      expect((error as Error).message).not.toMatch(/No configuration file found/);
    });

    it('CONTROL: the same raw spec in .gsloth.config.json yields a callable model', async () => {
      // The surviving control for the JSON route. After the fix the module path routes THROUGH
      // `tryJsonConfig`, so this cell no longer isolates the module path from the JSON one for
      // mechanism 1 — it is kept because it is what pins the behaviour the module path is being
      // brought into line WITH, and because it stays an independent control for mechanism 2 below.
      writeProjectJsonConfig({
        llm: { type: 'anthropic', model: 'json-spec-model' },
        streamOutput: true,
      });

      const { initConfig } = await import('#src/config.js');
      const config = await initConfig({});

      expect(ChatAnthropicMock).toHaveBeenCalledTimes(1);
      expect(typeof (config.llm as unknown as FakeChatModel).invoke).toBe('function');
      expect((config.llm as unknown as FakeChatModel).invoke()).toBe('invoked:json-spec-model');
    });
  });

  describe('mechanism 2 — a built instance under a global config that carries an llm block', () => {
    it('keeps the instance callable when the global layer carries an llm block', async () => {
      // THE cell this node turns on. The global `llm` is an object and the returned model is an
      // object, so the layer merge used to recurse into both and rebuild the instance as a plain
      // `{ ...target }` — dropping its prototype and with it `invoke`.
      writeGlobalConfig({ llm: { type: 'anthropic', model: 'global-model' } });
      writeProjectModuleConfig(MODULE_CONFIG_RETURNING_INSTANCE);

      const { initConfig } = await import('#src/config.js');
      const config = await initConfig({});

      const llm = config.llm as unknown as FakeChatModel;
      expect(typeof llm.invoke).toBe('function');
      expect(llm.invoke()).toBe('invoked:project-model');
      // The project's built instance WINS over the global spec rather than being blended with it:
      // no provider was ever asked to build the global's model.
      expect(ChatAnthropicMock).not.toHaveBeenCalled();
      expect((llm as unknown as { type?: unknown }).type).toBeUndefined();
      // The rest of the global layer still underlays the project layer as it always did.
      expect(config.streamOutput).toBe(true);
    });

    it('CONTRAST: with NO global llm block the instance survives even unfixed', async () => {
      // Not a redundant cell — it is the measurement that explains why this defect stayed hidden.
      // With no global `llm` key the merge never recurses, so an isolated-`HOME` run of the cell
      // above would report green against a completely broken loader. Kept green on purpose: it is
      // the control that must SURVIVE a mutation of the merge guard, while the cell above reds.
      writeGlobalConfig({ streamOutput: true });
      writeProjectModuleConfig(MODULE_CONFIG_RETURNING_INSTANCE);

      const { initConfig } = await import('#src/config.js');
      const config = await initConfig({});

      expect(typeof (config.llm as unknown as FakeChatModel).invoke).toBe('function');
      expect(ChatAnthropicMock).not.toHaveBeenCalled();
    });

    it('CONTROL: the JSON path is immune — it builds the model after the merge', async () => {
      // Independent control for mechanism 2: the JSON route never carries an instance INTO the
      // merge, so it must stay green whatever the merge does. Both layers carry an `llm` block, so
      // the merge really does recurse here — the project spec wins field-wise.
      writeGlobalConfig({ llm: { type: 'anthropic', model: 'global-model' } });
      writeProjectJsonConfig({ llm: { model: 'project-json-model' }, streamOutput: true });

      const { initConfig } = await import('#src/config.js');
      const config = await initConfig({});

      // `type` came from the global layer, `model` from the project layer: a real field-wise merge.
      expect(ChatAnthropicMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'anthropic', model: 'project-json-model' })
      );
      expect((config.llm as unknown as FakeChatModel).invoke()).toBe('invoked:project-json-model');
    });
  });
});
