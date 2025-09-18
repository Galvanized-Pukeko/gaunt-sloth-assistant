import { describe, expect, it } from 'vitest';
import { runCommandWithArgs } from './support/commandRunner.ts';

describe('Review Command Integration Tests', () => {
  it('should work with default profile', async () => {
    const output = await runCommandWithArgs(
      'npx',
      ['gth', 'ask', '"what is your name?"'],
      undefined,
      './integration-tests/workdir-with-profiles'
    );

    expect(output).toContain('Voreinstellung');

    const favouriteFishOutput = await runCommandWithArgs(
      'npx',
      ['gth', '-i fisher-alt', 'ask', '"What is your favourite fish?"'],
      undefined,
      './integration-tests/workdir-with-profiles'
    );

    expect(favouriteFishOutput, 'should use default profile guidelines').toContain('Snapper');
  });

  // Test for reviewing bad code
  it('should work with sorcerer profile', async () => {
    const nameOutput = await runCommandWithArgs(
      'npx',
      ['gth', '-i sorcerer', 'ask', '"what is your name?"'],
      undefined,
      './integration-tests/workdir-with-profiles'
    );
    expect(nameOutput).toContain('Bomp');

    const spellReviewOutput = await runCommandWithArgs(
      'npx',
      ['gth', '-i sorcerer', 'review', 'good-spell.txt'],
      undefined,
      './integration-tests/workdir-with-profiles'
    );

    expect(spellReviewOutput).toContain('AXIOS');

    const failedSpellOutput = await runCommandWithArgs(
      'npx',
      ['gth', '-i sorcerer', 'review', 'bad-spell.txt'],
      undefined,
      './integration-tests/workdir-with-profiles'
    );

    expect(failedSpellOutput).not.toContain('AXIOS');
  });

  it('should work with fisher-alt profile', async () => {
    const output = await runCommandWithArgs(
      'npx',
      ['gth', '-i fisher-alt', 'ask', '"what is your name?"'],
      undefined,
      './integration-tests/workdir-with-profiles'
    );

    expect(
      output,
      'Should fall back to install backstory, when profile has no backstory'
    ).toContain('Gaunt Sloth');

    const favouriteFishOutput = await runCommandWithArgs(
      'npx',
      ['gth', '-i fisher-alt', 'ask', '"What is your favourite fish?"'],
      undefined,
      './integration-tests/workdir-with-profiles'
    );

    expect(favouriteFishOutput, 'should use profile guidelines').toContain('Flounder');
  });
});
