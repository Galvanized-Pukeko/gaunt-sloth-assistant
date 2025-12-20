import { GthConfig } from '#src/config.js';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { ToolSchemaBase } from '@langchain/core/tools';
import { ChatVertexAI } from '@langchain/google-vertexai';
import { StatusUpdateCallback } from '#src/core/GthLangChainAgent.js';

const status = {
  update: (_msg: string) => {},
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type McpTool = DynamicStructuredTool<ToolSchemaBase, any, any, any>;

function isVertexLlm(config: GthConfig): boolean {
  return config.llm instanceof ChatVertexAI;
}

function mergeDescription(existing: string | undefined, extra: string): string {
  if (existing && existing.trim().length > 0) {
    const trimmed = existing.trim();
    const separator = trimmed.endsWith('.') || trimmed.endsWith(';') ? ' ' : '; ';
    return `${trimmed}${separator}${extra}`;
  }
  return extra;
}

type JsonSchema = {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  discriminator?: { propertyName?: string };
  enum?: Array<string | number | boolean | null>;
  const?: string | number | boolean | null;
};

function isJsonSchema(value: unknown): value is JsonSchema {
  return !!value && typeof value === 'object';
}

function describeJsonSchemaType(schema: JsonSchema | undefined): string {
  if (!schema) return 'value';
  if (schema.const !== undefined) return `literal(${JSON.stringify(schema.const)})`;
  if (schema.enum && schema.enum.length > 0) {
    return `enum(${schema.enum.map((value) => JSON.stringify(value)).join(' | ')})`;
  }
  if (schema.type) {
    if (Array.isArray(schema.type)) {
      return schema.type.join(' | ');
    }
    if (schema.type === 'array') {
      return `array<${describeJsonSchemaType(schema.items)}>`;
    }
    return schema.type;
  }
  if (schema.properties) return 'object';
  return 'value';
}

function buildUnionDescriptionFromSchema(options: JsonSchema[]): string {
  const optionDescriptions = options.map((option) => describeJsonSchemaType(option));
  return `Expected one of: ${optionDescriptions.join(' | ')}.`;
}

function buildDiscriminatedUnionDescriptionFromSchema(
  schema: JsonSchema,
  options: JsonSchema[]
): string {
  const discriminator = schema.discriminator?.propertyName;
  if (discriminator) {
    const values = options
      .map((option) => option.properties?.[discriminator])
      .map((property) => {
        if (!property) return '';
        if (property.const !== undefined) return JSON.stringify(property.const);
        if (property.enum && property.enum.length > 0) {
          return property.enum.map((value) => JSON.stringify(value)).join(' | ');
        }
        return '';
      })
      .filter((value) => value);
    if (values.length > 0) {
      return `Expected "${discriminator}" to be one of: ${values.join(', ')}.`;
    }
  }
  return buildUnionDescriptionFromSchema(options);
}

function replaceUnionSchemas(
  schema: unknown,
  context: { toolName: string; path: string[] }
): unknown {
  if (!isJsonSchema(schema)) {
    return schema;
  }

  if (schema.anyOf || schema.oneOf) {
    const options = schema.anyOf ?? schema.oneOf ?? [];
    const description = mergeDescription(
      schema.description,
      schema.discriminator
        ? buildDiscriminatedUnionDescriptionFromSchema(schema, options)
        : buildUnionDescriptionFromSchema(options)
    );
    // The unassignment below pull is for purpose of taking rest of parameters except unions.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { anyOf, oneOf, discriminator, ...rest } = schema;
    status.update(`${context.toolName}: converted schema union at ${context.path.join('.')}`);
    return {
      ...rest,
      description,
    };
  }

  if (schema.type === 'object' || schema.properties) {
    const properties = schema.properties ?? {};
    let hasChanges = false;
    const updatedProperties: Record<string, JsonSchema> = {};
    Object.entries(properties).forEach(([key, value]) => {
      const updatedValue = replaceUnionSchemas(value, {
        toolName: context.toolName,
        path: [...context.path, key],
      }) as JsonSchema;
      updatedProperties[key] = updatedValue;
      if (updatedValue !== value) {
        hasChanges = true;
      }
    });
    if (schema.items) {
      const updatedItems = replaceUnionSchemas(schema.items, {
        toolName: context.toolName,
        path: [...context.path, 'items'],
      }) as JsonSchema;
      hasChanges = hasChanges || updatedItems !== schema.items;
      return {
        ...schema,
        properties: hasChanges ? updatedProperties : schema.properties,
        items: updatedItems,
      };
    }
    if (!hasChanges) {
      return schema;
    }
    return {
      ...schema,
      properties: updatedProperties,
    };
  }

  if (schema.type === 'array' && schema.items) {
    return {
      ...schema,
      items: replaceUnionSchemas(schema.items, {
        toolName: context.toolName,
        path: [...context.path, 'items'],
      }) as JsonSchema,
    };
  }

  return schema;
}

function updateToolSchema(tool: McpTool): McpTool {
  const schema = tool.schema as unknown;
  if (!schema || typeof schema !== 'object') {
    return tool;
  }

  const updatedSchema = replaceUnionSchemas(schema, {
    toolName: tool.name ?? 'unknown',
    path: ['schema'],
  });
  if (updatedSchema === tool.schema) {
    return tool;
  }

  tool.schema = updatedSchema as ToolSchemaBase;
  return tool;
}

/**
 * Convert union types to flat types:
 * See https://github.com/langchain-ai/langchainjs/issues/9691
 * Since Langchain 1.2.1 Gemini explodes with the following error:
 * Error processing message: Agent processing failed:
 * Failed to convert tool 'mcp_tool_name' schema for Gemini: zod_to_gemini_parameters:
 * Gemini cannot handle union types (discriminatedUnion, anyOf, oneOf).
 * Consider using a flat object structure with optional fields instead.
 */
export function prepareMcpTools(
  statusUpdate: StatusUpdateCallback,
  config: GthConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: DynamicStructuredTool<ToolSchemaBase, any, any, any>[] | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): DynamicStructuredTool<ToolSchemaBase, any, any, any>[] | undefined {
  if (!tools || tools.length === 0) {
    return tools;
  }

  if (!isVertexLlm(config)) {
    return tools;
  }
  status.update = (msg) => statusUpdate('info', msg);
  status.update('converting tools for Vertex AI LLM to avoid schema issues.');
  return tools.map((tool) => {
    return updateToolSchema(tool);
  });
}
