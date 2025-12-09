import { AIMessage, SystemMessage } from '@langchain/core/messages';
import type { ClientTool, ServerTool } from '@langchain/core/tools';
import { StructuredToolInterface, tool } from '@langchain/core/tools';
import { randomUUID } from 'node:crypto';
import { type AgentMiddleware, createMiddleware } from 'langchain';
import * as z from 'zod';

import type { GthConfig } from '#src/config.js';
import { deleteArtifact, getArtifact, setArtifact } from '#src/state/artifactStore.js';
import GthFileSystemToolkit from '#src/tools/GthFileSystemToolkit.js';
import { getProjectDir } from '#src/utils/systemUtils.js';

const ADD_TOOL_NAME = 'gth_checklist_add_item';
const EDIT_TOOL_NAME = 'gth_checklist_edit_item';
const DELETE_TOOL_NAME = 'gth_checklist_delete_item';
const COMPLETE_TOOL_NAME = 'gth_checklist_complete_item';
const CROSS_TOOL_NAME = 'gth_checklist_cross_item';
const EMERGENCY_STOP_TOOL_NAME = 'gth_checklist_emergency_stop';

const CHECKLIST_STATUS_SCHEMA = z.enum(['pending', 'completed', 'crossed']);

const ChecklistItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: CHECKLIST_STATUS_SCHEMA,
});

const stateSchema = z.object({
  checklist: z.array(ChecklistItemSchema).default([]),
  checklistInitialized: z.boolean().default(false),
  checklistEmergencyStop: z.boolean().default(false),
});

export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;
export type ChecklistMiddlewareState = z.infer<typeof stateSchema>;

export type ChecklistMutation =
  | { kind: 'add'; title: string; id?: string }
  | { kind: 'edit'; id: string; title: string }
  | { kind: 'delete'; id: string }
  | { kind: 'complete'; id: string }
  | { kind: 'cross'; id: string };

export interface ChecklistMiddlewareSettings {
  name?: 'checklist';
  planningPrompt?: string;
  trackingPrompt?: string;
}

const CHECKLIST_ARTIFACT_KEY = 'gsloth.checklist.state';

const DEFAULT_PLANNING_PROMPT = [
  'Checklist middleware is active.',
  'Before executing work, analyze the request and create a concise checklist.',
  `Use the read-only filesystem tools to inspect the project as needed while creating the checklist.`,
  `Use ${ADD_TOOL_NAME} to create checklist.`, // `Use ${ADD_TOOL_NAME}, ${EDIT_TOOL_NAME}, and ${DELETE_TOOL_NAME} to build and refine the checklist.`,
  'Do not proceed to execution until the checklist covers the task.',
].join('\n');

const DEFAULT_TRACKING_PROMPT = [
  'Maintain the checklist as you work.',
  'You have full conversation history (including tool calls); update items as soon as they are satisfied.',
  `Use ${COMPLETE_TOOL_NAME} to mark finished work, ${CROSS_TOOL_NAME} to strike items that are no longer relevant, and ${ADD_TOOL_NAME} to capture new tasks.`,
  `Use ${EMERGENCY_STOP_TOOL_NAME} if you need to halt execution immediately.`,
].join('\n');

function generateId(): string {
  try {
    return randomUUID();
  } catch {
    return `chk_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  }
}

function statusBadge(status: z.infer<typeof CHECKLIST_STATUS_SCHEMA>): string {
  switch (status) {
    case 'completed':
      return '[x]';
    case 'crossed':
      return '[-]';
    default:
      return '[ ]';
  }
}

function formatChecklist(items: ChecklistItem[]): string {
  if (!items.length) {
    return 'Checklist is empty.';
  }

  return items.map((item) => `${statusBadge(item.status)} (${item.id}) ${item.title}`).join('\n');
}

function getIncompleteItems(items: ChecklistItem[]): ChecklistItem[] {
  return items.filter((item) => item.status === 'pending');
}

function buildIncompleteMessage(items: ChecklistItem[]): string {
  const header = 'Checklist incomplete. Pending items:';
  const rows = items.map((item) => `- ${statusBadge(item.status)} ${item.title} (${item.id})`);
  return [header, ...rows].join('\n');
}

function ensureItemExists(list: ChecklistItem[], id: string): number {
  const index = list.findIndex((item) => item.id === id);
  if (index === -1) {
    throw new Error(`Checklist item ${id} not found`);
  }
  return index;
}

export function applyChecklistMutation(
  list: ChecklistItem[],
  mutation: ChecklistMutation
): ChecklistItem[] {
  switch (mutation.kind) {
    case 'add': {
      const newItem: ChecklistItem = {
        id: mutation.id || generateId(),
        title: mutation.title,
        status: 'pending',
      };
      return [...list, newItem];
    }
    case 'edit': {
      const index = ensureItemExists(list, mutation.id);
      const updated = [...list];
      updated[index] = { ...updated[index], title: mutation.title };
      return updated;
    }
    case 'delete': {
      ensureItemExists(list, mutation.id);
      return list.filter((item) => item.id !== mutation.id);
    }
    case 'complete': {
      const index = ensureItemExists(list, mutation.id);
      const updated = [...list];
      updated[index] = { ...updated[index], status: 'completed' };
      return updated;
    }
    case 'cross': {
      const index = ensureItemExists(list, mutation.id);
      const updated = [...list];
      updated[index] = { ...updated[index], status: 'crossed' };
      return updated;
    }
    default:
      return list;
  }
}

type AnyTool = StructuredToolInterface | ClientTool | ServerTool | { name?: string };

function formatToolResult(text: string): string {
  return text;
}

export async function createChecklistMiddleware(
  settings: ChecklistMiddlewareSettings,
  _config: GthConfig
): Promise<AgentMiddleware> {
  const readToolkit = new GthFileSystemToolkit([getProjectDir()]);

  const defaultState: ChecklistMiddlewareState = {
    checklist: [],
    checklistInitialized: false,
    checklistEmergencyStop: false,
  };

  const loadPersistedState = (): ChecklistMiddlewareState => {
    const artifact = getArtifact<ChecklistMiddlewareState>(CHECKLIST_ARTIFACT_KEY);
    if (!artifact) return { ...defaultState };
    return {
      checklist: Array.isArray(artifact.checklist) ? artifact.checklist : [],
      checklistInitialized: artifact.checklistInitialized ?? defaultState.checklistInitialized,
      checklistEmergencyStop: artifact.checklistEmergencyStop ?? defaultState.checklistEmergencyStop,
    };
  };

  const persistState = (state: ChecklistMiddlewareState): void => {
    setArtifact(CHECKLIST_ARTIFACT_KEY, state);
  };

  const mergeExternalState = (state: Partial<ChecklistMiddlewareState>): ChecklistMiddlewareState => {
    const current = loadPersistedState();
    const merged: ChecklistMiddlewareState = {
      checklist: Array.isArray(state.checklist) ? state.checklist : current.checklist,
      checklistInitialized:
        state.checklistInitialized ?? current.checklistInitialized ?? current.checklist.length > 0,
      checklistEmergencyStop:
        state.checklistEmergencyStop ?? current.checklistEmergencyStop ?? false,
    };
    persistState(merged);
    return merged;
  };

  const addChecklistItem = tool(
    (input: { title: string; id?: string }) => {
      const current = loadPersistedState();
      const nextChecklist = applyChecklistMutation(current.checklist, {
        kind: 'add',
        title: input.title,
        id: input.id,
      });
      persistState({
        checklist: nextChecklist,
        checklistInitialized: true,
        checklistEmergencyStop: current.checklistEmergencyStop,
      });
      return formatToolResult(`Added checklist item: ${input.title}`);
    },
    {
      name: ADD_TOOL_NAME,
      description: 'Add a new checklist item capturing a concrete piece of work.',
      schema: z.object({
        title: z.string().min(1).describe('Short description of the checklist item'),
        id: z.string().optional().describe('Optional custom identifier for the item'),
      }),
    }
  );

  const editChecklistItem = tool(
    (input: { id: string; title: string }) => {
      const current = loadPersistedState();
      const nextChecklist = applyChecklistMutation(current.checklist, {
        kind: 'edit',
        id: input.id,
        title: input.title,
      });
      persistState({
        checklist: nextChecklist,
        checklistInitialized: current.checklistInitialized || nextChecklist.length > 0,
        checklistEmergencyStop: current.checklistEmergencyStop,
      });
      return formatToolResult(`Renamed checklist item ${input.id} to: ${input.title}`);
    },
    {
      name: EDIT_TOOL_NAME,
      description: 'Edit the title of an existing checklist item.',
      schema: z.object({
        id: z.string().describe('Identifier of the checklist item to edit'),
        title: z.string().min(1).describe('Updated title for the item'),
      }),
    }
  );

  const deleteChecklistItem = tool(
    (input: { id: string }) => {
      const current = loadPersistedState();
      const nextChecklist = applyChecklistMutation(current.checklist, {
        kind: 'delete',
        id: input.id,
      });
      persistState({
        checklist: nextChecklist,
        checklistInitialized: current.checklistInitialized || nextChecklist.length > 0,
        checklistEmergencyStop: current.checklistEmergencyStop,
      });
      return formatToolResult(`Deleted checklist item ${input.id}`);
    },
    {
      name: DELETE_TOOL_NAME,
      description: 'Delete a checklist item that is no longer required.',
      schema: z.object({
        id: z.string().describe('Identifier of the checklist item to delete'),
      }),
    }
  );

  const completeChecklistItem = tool(
    (input: { id: string }) => {
      const current = loadPersistedState();
      const nextChecklist = applyChecklistMutation(current.checklist, {
        kind: 'complete',
        id: input.id,
      });
      persistState({
        checklist: nextChecklist,
        checklistInitialized: current.checklistInitialized || nextChecklist.length > 0,
        checklistEmergencyStop: current.checklistEmergencyStop,
      });
      return formatToolResult(`Marked checklist item ${input.id} as complete.`);
    },
    {
      name: COMPLETE_TOOL_NAME,
      description: 'Mark an existing checklist item as completed.',
      schema: z.object({
        id: z.string().describe('Identifier of the checklist item to mark complete'),
      }),
    }
  );

  const crossChecklistItem = tool(
    (input: { id: string }) => {
      const current = loadPersistedState();
      const nextChecklist = applyChecklistMutation(current.checklist, {
        kind: 'cross',
        id: input.id,
      });
      persistState({
        checklist: nextChecklist,
        checklistInitialized: current.checklistInitialized || nextChecklist.length > 0,
        checklistEmergencyStop: current.checklistEmergencyStop,
      });
      return formatToolResult(`Crossed out checklist item ${input.id}.`);
    },
    {
      name: CROSS_TOOL_NAME,
      description: 'Cross out an item that is not required anymore.',
      schema: z.object({
        id: z.string().describe('Identifier of the checklist item to cross out'),
      }),
    }
  );

  const emergencyStopTool = tool(
    (input: { reason?: string }) => {
      const current = loadPersistedState();
      const emergencyStopState: ChecklistMiddlewareState = {
        checklist: current.checklist,
        checklistInitialized: current.checklistInitialized,
        checklistEmergencyStop: true,
      };
      persistState(emergencyStopState);
      const reason =
        input.reason && input.reason.trim().length > 0
          ? `Emergency stop requested: ${input.reason}`
          : 'Emergency stop requested.';
      return formatToolResult(reason);
    },
    {
      name: EMERGENCY_STOP_TOOL_NAME,
      description: 'Immediately halt the agent when continuing is unsafe.',
      schema: z.object({
        reason: z
          .string()
          .optional()
          .describe('Optional reason describing why execution should stop'),
      }),
    }
  );

  const planningTools = [addChecklistItem, editChecklistItem]; // removed deleteChecklistItem
  const trackingTools = [
    addChecklistItem,
    completeChecklistItem,
    crossChecklistItem,
    emergencyStopTool,
  ];
  const allChecklistTools = [
    ...planningTools,
    completeChecklistItem,
    crossChecklistItem,
    emergencyStopTool,
  ];

  const planningToolNames = new Set(
    planningTools.map((tool) => tool.name).filter(Boolean) as string[]
  );
  const trackingToolNames = new Set(
    trackingTools.map((tool) => tool.name).filter(Boolean) as string[]
  );
  const allChecklistToolNames = new Set([...planningToolNames, ...trackingToolNames] as string[]);

  return createMiddleware({
    name: 'checklist',
    stateSchema,
    tools: allChecklistTools,
    beforeAgent: (state) => {
      mergeExternalState(state as ChecklistMiddlewareState);
      return;
    },
    wrapModelCall: (request, handler) => {
      const currentState = mergeExternalState(request.state as ChecklistMiddlewareState);

      const baseTools = request.tools ?? [];
      const planningPhase = !currentState.checklistInitialized;
      const prompt = planningPhase
        ? (settings.planningPrompt ?? DEFAULT_PLANNING_PROMPT)
        : (settings.trackingPrompt ?? DEFAULT_TRACKING_PROMPT);

      const allowedNames = planningPhase ? planningToolNames : trackingToolNames;
      const filteredBaseTools = planningPhase
        ? baseTools.filter(
            (tool) => (tool as { gthFileSystemType?: string }).gthFileSystemType !== 'write'
          )
        : baseTools;
      const filteredTools = filteredBaseTools.filter((tool) => {
        const name = (tool as { name?: unknown }).name;
        if (typeof name !== 'string') return true;
        if (!allChecklistToolNames.has(name)) return true;
        return allowedNames.has(name);
      });

      const messages = request.messages ?? [];
      let updatedMessages = messages;
      if (messages.length > 0 && SystemMessage.isInstance(messages[0])) {
        const first = messages[0];
        const mergedContent =
          typeof first.content === 'string'
            ? `${first.content}\n\n${prompt}`
            : [...first.content, { type: 'text', text: prompt }];

        updatedMessages = [
          new SystemMessage({
            content: mergedContent,
            additional_kwargs: first.additional_kwargs ?? {},
          }),
          ...messages.slice(1),
        ];
      } else {
        updatedMessages = [new SystemMessage(prompt), ...messages];
      }

      return handler({
        ...request,
        tools: filteredTools,
        messages: updatedMessages,
        systemMessage: undefined,
      });
    },
    afterModel: (state) => {
      mergeExternalState(state as ChecklistMiddlewareState);
      return;
    },
    afterAgent: (state) => {
      const currentState = mergeExternalState(state as ChecklistMiddlewareState);
      const pending = getIncompleteItems(currentState.checklist);
      if (pending.length === 0) {
        return;
      }

      const messages = Array.isArray(state.messages) ? state.messages : [];
      return {
        messages: [...messages, new AIMessage(buildIncompleteMessage(pending))],
      };
    },
  });
}
