import { beforeEach, describe, expect, it, vi } from 'vitest';

const execAsyncMock = vi.fn();
const displayWarningMock = vi.fn();
const progressIndicatorStopMock = vi.fn();
const debugLogMock = vi.fn();

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
vi.mock('@gaunt-sloth/core/utils/debugUtils.js', () => ({
  debugLog: debugLogMock,
}));

describe('ghPrViewSource', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('fetches PR metadata by number', async () => {
    execAsyncMock.mockResolvedValue(
      JSON.stringify({
        number: 358,
        title: 'Add PR auto mode',
        body: 'Requirements: #359',
        url: 'https://github.com/owner/repo/pull/358',
        headRefName: 'feature/pr-auto-mode',
        baseRefName: 'main',
      })
    );

    const { get } = await import('#src/sources/ghPrViewSource.js');
    const result = await get(null, '358');

    expect(execAsyncMock).toHaveBeenCalledWith(
      'gh pr view 358 --json number,title,body,url,headRefName,baseRefName'
    );
    expect(result).toContain('GitHub PR: #358');
    expect(result).toContain('Title: Add PR auto mode');
    expect(result).toContain('Description:\nRequirements: #359');
    expect(displayWarningMock).not.toHaveBeenCalled();
  });

  it('fetches current branch PR metadata when no PR number is provided', async () => {
    execAsyncMock.mockResolvedValue(JSON.stringify({ number: 358, title: 'Add PR auto mode' }));

    const { get } = await import('#src/sources/ghPrViewSource.js');
    const result = await get(null, undefined);

    expect(execAsyncMock).toHaveBeenCalledWith(
      'gh pr view --json number,title,body,url,headRefName,baseRefName'
    );
    expect(result).toContain('GitHub PR: #358');
    expect(displayWarningMock).not.toHaveBeenCalled();
  });

  it('rejects non-numeric PR numbers without invoking gh', async () => {
    const { get } = await import('#src/sources/ghPrViewSource.js');
    const result = await get(null, '358;rm${IFS}-rf');

    expect(result).toBeNull();
    expect(execAsyncMock).not.toHaveBeenCalled();
    expect(displayWarningMock).toHaveBeenCalledWith(
      expect.stringContaining('Invalid GitHub PR number')
    );
  });
});
