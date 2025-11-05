import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from '#src/tools/gthSequentialThinkingTool.js';
import { GthConfig } from '#src/config.js';
import { displayInfo } from '#src/utils/consoleUtils.js';

vi.mock('#src/utils/consoleUtils.js');

describe('gthSequentialThinkingTool', () => {
  let config: GthConfig;
  let mockDisplayInfo: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    config = {} as GthConfig;
    mockDisplayInfo = vi.mocked(displayInfo);
    vi.clearAllMocks();
    process.env.DISABLE_THOUGHT_LOGGING = '';
  });

  describe('tool creation', () => {
    it('should create a tool with correct name and description', () => {
      const tool = get(config);
      expect(tool.name).toBe('gth_sequential_thinking');
      expect(tool.description).toContain('Sequential Thinking Tool');
      expect(tool.description).toContain('dynamic and reflective problem-solving');
    });
  });

  describe('basic functionality', () => {
    it('should process a simple thought', async () => {
      const tool = get(config);

      const input = {
        thought: 'Let me analyze this problem step by step',
        nextThoughtNeeded: true,
        thoughtNumber: 1,
        totalThoughts: 3,
      };

      const result = await tool.invoke(input);

      expect(result).toBeDefined();
      expect(typeof result).toBe('string');

      const parsedResult = JSON.parse(result);
      expect(parsedResult.thoughtNumber).toBe(1);
      expect(parsedResult.totalThoughts).toBe(3);
      expect(parsedResult.nextThoughtNeeded).toBe(true);
      expect(parsedResult.thoughtHistoryLength).toBe(1);
    });

    it('should auto-adjust total thoughts when thought number exceeds total', async () => {
      const tool = get(config);

      const input = {
        thought: 'This is thought 5',
        nextThoughtNeeded: false,
        thoughtNumber: 5,
        totalThoughts: 3,
      };

      const result = await tool.invoke(input);
      const parsedResult = JSON.parse(result);

      expect(parsedResult.thoughtNumber).toBe(5);
      expect(parsedResult.totalThoughts).toBe(5);
    });
  });

  describe('revision functionality', () => {
    it('should handle thought revisions', async () => {
      const tool = get(config);

      const input = {
        thought: 'Actually, let me reconsider my previous analysis',
        nextThoughtNeeded: true,
        thoughtNumber: 3,
        totalThoughts: 5,
        isRevision: true,
        revisesThought: 2,
      };

      const result = await tool.invoke(input);
      const parsedResult = JSON.parse(result);

      expect(parsedResult.thoughtNumber).toBe(3);
      expect(parsedResult.totalThoughts).toBe(5);
      expect(parsedResult.nextThoughtNeeded).toBe(true);
    });
  });

  describe('branching functionality', () => {
    it('should handle thought branches', async () => {
      const tool = get(config);

      const input = {
        thought: 'Let me explore an alternative approach',
        nextThoughtNeeded: true,
        thoughtNumber: 3,
        totalThoughts: 5,
        branchFromThought: 2,
        branchId: 'alternative-approach',
      };

      const result = await tool.invoke(input);
      const parsedResult = JSON.parse(result);

      expect(parsedResult.thoughtNumber).toBe(3);
      expect(parsedResult.branches).toContain('alternative-approach');
      expect(parsedResult.thoughtHistoryLength).toBe(1);
    });

    it('should track multiple branches', async () => {
      const tool = get(config);

      // Create first branch
      await tool.invoke({
        thought: 'First branch',
        nextThoughtNeeded: true,
        thoughtNumber: 1,
        totalThoughts: 3,
        branchFromThought: 1,
        branchId: 'branch1',
      });

      // Create second branch
      const result = await tool.invoke({
        thought: 'Second branch',
        nextThoughtNeeded: true,
        thoughtNumber: 1,
        totalThoughts: 3,
        branchFromThought: 1,
        branchId: 'branch2',
      });

      const parsedResult = JSON.parse(result);
      expect(parsedResult.branches).toHaveLength(2);
      expect(parsedResult.branches).toContain('branch1');
      expect(parsedResult.branches).toContain('branch2');
    });
  });

  describe('thought logging', () => {
    it('should display formatted thoughts by default', async () => {
      const tool = get(config);

      const input = {
        thought: 'This is a test thought',
        nextThoughtNeeded: true,
        thoughtNumber: 1,
        totalThoughts: 3,
      };

      await tool.invoke(input);

      expect(mockDisplayInfo).toHaveBeenCalledOnce();
      const loggedMessage = mockDisplayInfo.mock.calls[0][0];
      expect(loggedMessage).toContain('💭 Thought');
      expect(loggedMessage).toContain('1/3');
      expect(loggedMessage).toContain('This is a test thought');
    });

    it('should not display thoughts when logging is disabled', async () => {
      process.env.DISABLE_THOUGHT_LOGGING = 'true';

      const tool = get(config);

      const input = {
        thought: 'This thought should not be logged',
        nextThoughtNeeded: true,
        thoughtNumber: 1,
        totalThoughts: 3,
      };

      await tool.invoke(input);

      expect(mockDisplayInfo).not.toHaveBeenCalled();

      // Reset env var
      process.env.DISABLE_THOUGHT_LOGGING = '';
    });

    it('should display revision formatting', async () => {
      const tool = get(config);

      const input = {
        thought: 'Revised thought',
        nextThoughtNeeded: true,
        thoughtNumber: 2,
        totalThoughts: 3,
        isRevision: true,
        revisesThought: 1,
      };

      await tool.invoke(input);

      expect(mockDisplayInfo).toHaveBeenCalledOnce();
      const loggedMessage = mockDisplayInfo.mock.calls[0][0];
      expect(loggedMessage).toContain('🔄 Revision');
      expect(loggedMessage).toContain('(revising thought 1)');
    });

    it('should display branch formatting', async () => {
      const tool = get(config);

      const input = {
        thought: 'Branched thought',
        nextThoughtNeeded: true,
        thoughtNumber: 2,
        totalThoughts: 3,
        branchFromThought: 1,
        branchId: 'test-branch',
      };

      await tool.invoke(input);

      expect(mockDisplayInfo).toHaveBeenCalledOnce();
      const loggedMessage = mockDisplayInfo.mock.calls[0][0];
      expect(loggedMessage).toContain('🌿 Branch');
      expect(loggedMessage).toContain('(from thought 1, ID: test-branch)');
    });
  });

  describe('thought history', () => {
    it('should accumulate thought history', async () => {
      const tool = get(config);

      // First thought
      await tool.invoke({
        thought: 'First thought',
        nextThoughtNeeded: true,
        thoughtNumber: 1,
        totalThoughts: 3,
      });

      // Second thought
      const result = await tool.invoke({
        thought: 'Second thought',
        nextThoughtNeeded: true,
        thoughtNumber: 2,
        totalThoughts: 3,
      });

      const parsedResult = JSON.parse(result);
      expect(parsedResult.thoughtHistoryLength).toBe(2);
    });
  });

  describe('optional parameters', () => {
    it('should handle needsMoreThoughts parameter', async () => {
      const tool = get(config);

      const input = {
        thought: 'This problem needs more analysis',
        nextThoughtNeeded: true,
        thoughtNumber: 3,
        totalThoughts: 3,
        needsMoreThoughts: true,
      };

      const result = await tool.invoke(input);
      const parsedResult = JSON.parse(result);

      expect(parsedResult.thoughtNumber).toBe(3);
      expect(parsedResult.totalThoughts).toBe(3);
      expect(parsedResult.nextThoughtNeeded).toBe(true);
    });
  });
});
