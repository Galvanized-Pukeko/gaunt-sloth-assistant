import { beforeEach, describe, expect, it, vi } from 'vitest';

const execAsyncMock = vi.fn();
const displayWarningMock = vi.fn();
const progressIndicatorStopMock = vi.fn();

vi.mock('@gaunt-sloth/core/utils/systemUtils.js', () => ({
  execAsync: execAsyncMock,
}));
vi.mock('@gaunt-sloth/core/utils/consoleUtils.js', () => ({
  displayWarning: displayWarningMock,
}));
vi.mock('@gaunt-sloth/core/utils/ProgressIndicator.js', () => {
  const ProgressIndicator = vi.fn();
  ProgressIndicator.prototype.stop = progressIndicatorStopMock;
  return { ProgressIndicator };
});

describe('ghPrDiffSource', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('fetches a PR diff by number', async () => {
    execAsyncMock.mockResolvedValue('diff body');

    const { get } = await import('#src/sources/ghPrDiffSource.js');
    const result = await get(null, '358');

    expect(execAsyncMock).toHaveBeenCalledWith('gh pr diff 358');
    expect(result).toBe('GitHub PR Diff: #358\n\ndiff body');
    expect(displayWarningMock).not.toHaveBeenCalled();
  });

  it('fetches the current branch PR diff when no PR number is provided', async () => {
    execAsyncMock.mockResolvedValue('diff body');

    const { get } = await import('#src/sources/ghPrDiffSource.js');
    const result = await get(null, undefined);

    expect(execAsyncMock).toHaveBeenCalledWith('gh pr diff');
    expect(result).toBe('GitHub PR Diff: for current branch\n\ndiff body');
    expect(displayWarningMock).not.toHaveBeenCalled();
  });

  it('rejects non-numeric PR numbers without invoking gh', async () => {
    const { get } = await import('#src/sources/ghPrDiffSource.js');
    const result = await get(null, '358;rm${IFS}-rf');

    expect(result).toBeNull();
    expect(execAsyncMock).not.toHaveBeenCalled();
    expect(displayWarningMock).toHaveBeenCalledWith(
      expect.stringContaining('Invalid GitHub PR number')
    );
  });
});
