import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GthConfig } from '@gaunt-sloth/core/config.js';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

const processMessagesMock = vi.hoisted(() => vi.fn());
const initMock = vi.hoisted(() => vi.fn());
const cleanupMock = vi.hoisted(() => vi.fn());
const ghDiffMock = vi.hoisted(() => vi.fn());
const ghPrViewMock = vi.hoisted(() => vi.fn());
const ghIssueMock = vi.hoisted(() => vi.fn());
const displayInfoMock = vi.hoisted(() => vi.fn());

vi.mock('@gaunt-sloth/core/core/GthAgentRunner.js', () => ({
  GthAgentRunner: vi.fn(function GthAgentRunnerMock() {
    return {
      init: initMock,
      processMessages: processMessagesMock,
      cleanup: cleanupMock,
    };
  }),
}));

vi.mock('@gaunt-sloth/core/utils/consoleUtils.js', () => ({
  defaultStatusCallback: vi.fn(),
  displayInfo: displayInfoMock,
  displayWarning: vi.fn(),
}));

vi.mock('@gaunt-sloth/api/resolvers.js', () => ({
  createResolvers: vi.fn(() => ({})),
}));

vi.mock('@gaunt-sloth/review/sources/ghPrDiffSource.js', () => ({
  get: ghDiffMock,
}));

vi.mock('@gaunt-sloth/review/sources/ghPrViewSource.js', () => ({
  get: ghPrViewMock,
}));

vi.mock('@gaunt-sloth/review/sources/ghIssueSource.js', () => ({
  get: ghIssueMock,
}));

describe('runPrAutoMode', () => {
  const config = {
    llm: { invoke: vi.fn() } as unknown as BaseChatModel,
    projectGuidelines: '.gsloth.guidelines.md',
    projectReviewInstructions: '.gsloth.review.md',
    contentProvider: 'github',
    requirementsProvider: 'github',
    streamOutput: false,
    filesystem: 'none',
    useColour: false,
    writeOutputToFile: true,
    writeBinaryOutputsToFile: true,
    streamSessionInferenceLog: true,
    canInterruptInferenceWithEsc: true,
    includeCurrentDateAfterGuidelines: false,
    contentSource: 'github',
    requirementSource: 'github',
    commands: {
      pr: {
        contentProvider: 'github',
        requirementsProvider: 'github',
        auto: {
          enabled: true,
          deterministicDiff: true,
        },
      },
      review: {},
    },
  } as Partial<GthConfig> as GthConfig;

  beforeEach(() => {
    vi.resetAllMocks();
    ghDiffMock.mockResolvedValue('Diff from gh');
    ghPrViewMock.mockResolvedValue(`GitHub PR: #360
Description:
Requirements: https://github.com/Galvanized-Pukeko/gaunt-sloth-assistant/issues/359`);
    ghIssueMock.mockResolvedValue('Issue #359 requirements');
  });

  it('skips the discovery agent when diff and requirements are deterministically resolved', async () => {
    const { runPrAutoMode } = await import('#src/commands/prAutoMode.js');

    const result = await runPrAutoMode(config);

    expect(result).toEqual({
      diff: 'Diff from gh',
      requirements: 'Issue #359 requirements',
    });
    expect(ghDiffMock).toHaveBeenCalledWith(null, undefined);
    expect(ghPrViewMock).toHaveBeenCalledWith(null, undefined);
    expect(ghIssueMock).toHaveBeenCalledWith(null, '359');
    expect(initMock).not.toHaveBeenCalled();
    expect(processMessagesMock).not.toHaveBeenCalled();
    expect(cleanupMock).not.toHaveBeenCalled();
    expect(displayInfoMock).toHaveBeenCalledWith(
      'Auto mode already has a deterministic PR diff and requirements; skipping discovery agent.'
    );
  });
});
