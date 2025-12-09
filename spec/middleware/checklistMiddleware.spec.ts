import { beforeEach, describe, expect, it, vi } from 'vitest';

type GthConfig = import('#src/config.js').GthConfig;

describe('checklist middleware helpers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('applies checklist mutations', async () => {
    const { applyChecklistMutation } = await import('#src/middleware/checklistMiddleware.js');

    const created = applyChecklistMutation([], { kind: 'add', title: 'Write tests', id: 'id-1' });
    expect(created).toEqual([{ id: 'id-1', title: 'Write tests', status: 'pending' }]);

    const completed = applyChecklistMutation(created, { kind: 'complete', id: 'id-1' });
    expect(completed[0].status).toBe('completed');

    expect(() =>
      applyChecklistMutation(created, { kind: 'edit', id: 'missing', title: 'Noop' })
    ).toThrowError(/not found/);
  });

  it('adds a message when checklist items remain incomplete at the end', async () => {
    const { createChecklistMiddleware } = await import('#src/middleware/checklistMiddleware.js');
    const middleware = await createChecklistMiddleware({ name: 'checklist' }, {} as GthConfig);

    const state = {
      checklist: [{ id: 'id-1', title: 'Pending task', status: 'pending' }],
      messages: [],
    };

    const afterAgent = middleware.afterAgent as
      | ((state: unknown, runtime: unknown) => unknown)
      | { hook: (state: unknown, runtime: unknown) => unknown }
      | undefined;
    const result =
      typeof afterAgent === 'function'
        ? await afterAgent(state as never, {} as never)
        : await afterAgent?.hook(state as never, {} as never);

    const messages = (result as { messages?: unknown[] } | undefined)?.messages ?? [];

    expect(messages.length).toBe(1);
    expect((messages[0] as { content?: string }).content).toContain('Checklist incomplete');
    expect((messages[0] as { content?: string }).content).toContain('Pending task');
  });
});
