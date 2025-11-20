import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from '#src/providers/ghPrDiffProvider.js';
import { ProgressIndicator } from '#src/utils/ProgressIndicator.js';
import { execAsync } from '#src/utils/systemUtils.js';

// Mock dependencies
vi.mock('#src/utils/ProgressIndicator.js');
vi.mock('#src/utils/systemUtils.js');
vi.mock('#src/utils/consoleUtils.js', () => ({
  displayWarning: vi.fn(),
}));

describe('ghPrDiffProvider', () => {
  let stopMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stopMock = vi.fn();
    (ProgressIndicator as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      stop: stopMock,
    }));
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should stop progress indicator and throw error when execAsync throws an error', async () => {
    // Arrange
    const error = new Error('GitHub CLI failed');
    (execAsync as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(error);

    // Act & Assert
    await expect(get(null, '123')).rejects.toThrow(
      'Failed to get GitHub PR diff #123: GitHub CLI failed'
    );
    expect(ProgressIndicator).toHaveBeenCalledWith('Fetching GitHub PR #123 diff');
    expect(stopMock).toHaveBeenCalled();
  });

  it('should stop progress indicator when successful', async () => {
    // Arrange
    (execAsync as unknown as ReturnType<typeof vi.fn>).mockResolvedValue('diff content');

    // Act
    await get(null, '123');

    // Assert
    expect(ProgressIndicator).toHaveBeenCalledWith('Fetching GitHub PR #123 diff');
    expect(stopMock).toHaveBeenCalled();
  });
});
