import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DynamicStructuredTool } from '@langchain/core/tools';
import type { GthConfig } from '#src/config.js';

vi.mock('@langchain/google-vertexai', () => ({
  ChatVertexAI: class ChatVertexAI {},
}));

describe('prepareMcpTools', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should keep union schemas unchanged for non-Vertex LLMs', async () => {
    const schema = {
      type: 'object',
      properties: {
        ids: {
          anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }],
          description: 'Filter by ids',
        },
      },
    } as const;
    const tool = new DynamicStructuredTool({
      name: 'mcp__jira__getConfluenceSpaces',
      description: 'Test tool',
      schema,
      func: async () => 'ok',
    });
    const config = { llm: {} } as Partial<GthConfig>;

    const { prepareMcpTools } = await import('#src/utils/mcpUtils.js');
    const result = prepareMcpTools(vi.fn(), config as GthConfig, [tool]);

    const idsSchema = (result?.[0].schema as any).properties.ids;
    expect(idsSchema.anyOf).toBeDefined();
  });

  it('should convert anyOf union schemas to z.any for Vertex', async () => {
    const schema = {
      type: 'object',
      properties: {
        ids: {
          anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }],
          description: 'Filter by ids',
        },
      },
    } as const;
    const tool = new DynamicStructuredTool({
      name: 'mcp__jira__getConfluenceSpaces',
      description: 'Test tool',
      schema,
      func: async () => 'ok',
    });
    const { ChatVertexAI } = await import('@langchain/google-vertexai');
    const config = { llm: new ChatVertexAI() } as Partial<GthConfig>;

    const { prepareMcpTools } = await import('#src/utils/mcpUtils.js');
    const result = prepareMcpTools(vi.fn(), config as GthConfig, [tool]);

    const idsSchema = (result?.[0].schema as any).properties.ids;
    expect(idsSchema.anyOf).toBeUndefined();
    expect(idsSchema.description).toContain('Filter by ids');
    expect(idsSchema.description).toContain('string');
  });

  it('should convert oneOf union schemas created via .or to z.any for Vertex', async () => {
    const schema = {
      type: 'object',
      properties: {
        keys: {
          oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          description: 'Filter by keys',
        },
      },
    } as const;
    const tool = new DynamicStructuredTool({
      name: 'mcp__jira__getConfluenceSpaces',
      description: 'Test tool',
      schema,
      func: async () => 'ok',
    });
    const { ChatVertexAI } = await import('@langchain/google-vertexai');
    const config = { llm: new ChatVertexAI() } as Partial<GthConfig>;

    const { prepareMcpTools } = await import('#src/utils/mcpUtils.js');
    const result = prepareMcpTools(vi.fn(), config as GthConfig, [tool]);

    const keysSchema = (result?.[0].schema as any).properties.keys;
    expect(keysSchema.oneOf).toBeUndefined();
    expect(keysSchema.description).toContain('Filter by keys');
    expect(keysSchema.description).toContain('array');
  });

  it('should convert discriminatedUnion schemas to z.any for Vertex', async () => {
    const schema = {
      type: 'object',
      properties: {
        payload: {
          description: 'Payload',
          discriminator: { propertyName: 'kind' },
          oneOf: [
            {
              type: 'object',
              properties: {
                kind: { const: 'a' },
                value: { type: 'string' },
              },
              required: ['kind', 'value'],
            },
            {
              type: 'object',
              properties: {
                kind: { const: 'b' },
                count: { type: 'number' },
              },
              required: ['kind', 'count'],
            },
          ],
        },
      },
    } as const;
    const tool = new DynamicStructuredTool({
      name: 'mcp__jira__getConfluenceSpaces',
      description: 'Test tool',
      schema,
      func: async () => 'ok',
    });
    const { ChatVertexAI } = await import('@langchain/google-vertexai');
    const config = { llm: new ChatVertexAI() } as Partial<GthConfig>;

    const { prepareMcpTools } = await import('#src/utils/mcpUtils.js');
    const result = prepareMcpTools(vi.fn(), config as GthConfig, [tool]);

    const payloadSchema = (result?.[0].schema as any).properties.payload;
    expect(payloadSchema.oneOf).toBeUndefined();
    expect(payloadSchema.description).toContain('Payload');
    expect(payloadSchema.description).toContain('kind');
    expect(payloadSchema.description).toContain('"a"');
  });
});
