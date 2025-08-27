import { describe, test, expect, vi } from 'vitest';

// Mock node:crypto randomUUID for deterministic tests
vi.mock('node:crypto', async () => {
  const actual = await vi.importActual<typeof import('node:crypto')>('node:crypto');
  return {
    ...actual,
    randomUUID: () => '12345678-aaaa-bbbb-cccc-1234567890ab',
  };
});

import { wrapContent } from '#src/utils/llmUtils.js';

describe('wrapContent', () => {
  test('returns original content when empty and alwaysWrap=false', () => {
    const result = wrapContent('', 'block', 'content', false);
    expect(result).toBe('');
  });

  test('wraps content when non-empty using defaults', () => {
    const input = 'Hello world';
    const result = wrapContent(input);

    const expected =
      `\nProvided content follows within block-1234567 block\n` +
      `<block-1234567>\n` +
      `${input}\n` +
      `</block-1234567>\n`;

    expect(result).toBe(expected);
  });

  test('wraps when empty content but alwaysWrap=true', () => {
    const result = wrapContent('', 'block', 'content', true);

    const expected =
      `\nProvided content follows within block-1234567 block\n` +
      `<block-1234567>\n` +
      `\n` +
      `</block-1234567>\n`;

    expect(result).toBe(expected);
  });

  test('respects custom wrapBlockPrefix and prefix', () => {
    const input = 'Custom content';
    const result = wrapContent(input, 'myblock', 'myPrefix');

    const expected =
      `\nProvided myPrefix follows within myblock-1234567 block\n` +
      `<myblock-1234567>\n` +
      `${input}\n` +
      `</myblock-1234567>\n`;

    expect(result).toBe(expected);
  });
});
