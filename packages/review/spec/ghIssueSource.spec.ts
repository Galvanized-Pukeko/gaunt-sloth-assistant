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

describe('ghIssueSource', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('fetches an issue by number', async () => {
    execAsyncMock.mockResolvedValue('issue body');

    const { get } = await import('#src/sources/ghIssueSource.js');
    const result = await get(null, '359');

    expect(execAsyncMock).toHaveBeenCalledWith('gh issue view 359');
    expect(result).toBe('GitHub Issue: #359\n\nissue body');
    expect(displayWarningMock).not.toHaveBeenCalled();
  });

  it('fetches an issue by full URL so cross-repo references resolve in the right repository', async () => {
    execAsyncMock.mockResolvedValue('issue body');

    const { get } = await import('#src/sources/ghIssueSource.js');
    const result = await get(null, 'https://github.com/other-owner/other-repo/issues/12');

    expect(execAsyncMock).toHaveBeenCalledWith(
      'gh issue view https://github.com/other-owner/other-repo/issues/12'
    );
    expect(result).toBe(
      'GitHub Issue: https://github.com/other-owner/other-repo/issues/12\n\nissue body'
    );
    expect(displayWarningMock).not.toHaveBeenCalled();
  });

  it('rejects references that are neither a number nor a strict issue URL without invoking gh', async () => {
    const { get } = await import('#src/sources/ghIssueSource.js');
    // The reference is interpolated into a shell command, so a loose value coming from an
    // untrusted PR description must never reach execAsync.
    const result = await get(null, 'https://github.com/owner/repo/issues/1;rm${IFS}-rf');

    expect(result).toBeNull();
    expect(execAsyncMock).not.toHaveBeenCalled();
    expect(displayWarningMock).toHaveBeenCalledWith(
      expect.stringContaining('Invalid GitHub issue reference')
    );
  });

  it('returns null and warns when no issue reference is provided', async () => {
    const { get } = await import('#src/sources/ghIssueSource.js');
    const result = await get(null, undefined);

    expect(result).toBeNull();
    expect(execAsyncMock).not.toHaveBeenCalled();
    expect(displayWarningMock).toHaveBeenCalledWith('No GitHub issue number provided');
  });
});
