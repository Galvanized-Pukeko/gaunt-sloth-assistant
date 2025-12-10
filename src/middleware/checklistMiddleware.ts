import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { getArtifact, setArtifact } from '#src/state/artifactStore.js';
import { createMiddleware } from 'langchain';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { GthConfig } from '#src/config.js';
import { debugLogObject } from '#src/utils/debugUtils.js';
import { displayInfo, displayWarning } from '#src/utils/consoleUtils.js';

export interface ChecklistMiddlewareSettings {
  name?: 'checklist';
}

export const CHECKLIST_ITEMS_ARTIFACT_KEY = 'gsloth.checklist.items';
export const CHECKLIST_STATE_ARTIFACT_KEY = 'gsloth.checklist.state';
export const TOOL_NAMES_ARTIFACT_KEY = 'gsloth.checklist.tools';

const CHECKLIST_ADD_ITEM_TOOL_NAME = 'gth_checklist_add_item';
const CHECKLIST_COMPLETE_ITEM_TOOL_NAME = 'gth_checklist_complete_item';
const CHECKLIST_FINALIZE_PLAN_TOOL_NAME = 'gth_checklist_finalize_plan';
const CHECKLIST_WARNING_TOOL_NAME = 'gth_checklist_warning';

enum ChecklistState {
  DRAFT,
  IN_PROGRESS,
  COMPLETED,
  ABORTED,
}

enum ChecklistItemState {
  CREATED,
  CROSSED_OUT,
  COMPLETED,
}

interface Checklist {
  state: ChecklistState;
  items: ChecklistItem[];
}

interface ChecklistItem {
  id: number;
  description: string;
  state: ChecklistItemState;
}
const DEFAULT_PLANNING_PROMPT = `Please create a thorough plan of requested changes. The checklist is now in DRAFT state.
**Protocol**
1. Create checklist items one by one using ${CHECKLIST_ADD_ITEM_TOOL_NAME}
2. Call ${CHECKLIST_FINALIZE_PLAN_TOOL_NAME} to finalize the checklist. You must call ${CHECKLIST_FINALIZE_PLAN_TOOL_NAME}.
Do not attempt writing files before calling ${CHECKLIST_FINALIZE_PLAN_TOOL_NAME}.
`;

function getChecklistItems(): ChecklistItem[] {
  return getArtifact(CHECKLIST_ITEMS_ARTIFACT_KEY) ?? [];
}

function getChecklistState(): ChecklistState {
  return getArtifact(CHECKLIST_STATE_ARTIFACT_KEY) ?? ChecklistState.DRAFT;
}

function getChecklist(): Checklist {
  return {
    state: getChecklistState(),
    items: getChecklistItems(),
  };
}

const addChecklistItemTool = tool(
  (input: { description: string }) => {
    const items: ChecklistItem[] = getArtifact(CHECKLIST_ITEMS_ARTIFACT_KEY) ?? [];
    const newId = items.length;
    const newLength = items.push({
      id: newId,
      description: input.description,
      state: ChecklistItemState.CREATED,
    });
    setArtifact(CHECKLIST_ITEMS_ARTIFACT_KEY, items);
    return `Created item ${JSON.stringify(items[newLength - 1])}`;
  },
  {
    name: CHECKLIST_ADD_ITEM_TOOL_NAME,
    description: 'Add a new item to the checklist',
    schema: z.object({
      description: z.string().describe('The description of the checklist item to add'),
    }),
  }
);

const finalizeChecklistTool = tool(
  () => {
    setArtifact(CHECKLIST_STATE_ARTIFACT_KEY, ChecklistState.IN_PROGRESS);
    // TODO need properly formatted message
    const message = `Finalized checklist: ${JSON.stringify(getChecklist())}`;
    displayInfo(message);
    return message;
  },
  {
    name: CHECKLIST_FINALIZE_PLAN_TOOL_NAME,
    description: 'Finalize the checklist and move checklist to IN_PROGRESS state',
  }
);

const markChecklistItemAsCompleted = tool(
  (toComplete: { id: number }) => {
    const items = getChecklistItems();
    const checklistItemId = toComplete?.id;
    if (!items[checklistItemId]) {
      return `Checklist item ${checklistItemId} not found`;
    }
    items[checklistItemId].state = ChecklistItemState.COMPLETED;
    setArtifact(CHECKLIST_ITEMS_ARTIFACT_KEY, items);
    return `Marked item ${checklistItemId} as completed ${JSON.stringify(items[checklistItemId])}`;
  },
  {
    name: CHECKLIST_COMPLETE_ITEM_TOOL_NAME,
    description: 'Mark a checklist item as completed',
    schema: z.object({
      id: z.number().describe('The id of the checklist item to mark as completed'),
    }),
  }
);

const getChecklistTool = tool(
  () => {
    return JSON.stringify(getChecklist());
  },
  {
    name: 'gth_checklist_get',
    description: 'Get the current checklist including state and items',
  }
);

const warningTool = tool(
  (input: { message: string }) => {
    return `WARNING: ${input.message}`;
  },
  {
    name: CHECKLIST_WARNING_TOOL_NAME,
    description: 'Display a warning message',
    schema: z.object({
      message: z.string().describe('The message to display as a warning'),
    }),
  }
);

const checklistTools = [addChecklistItemTool, finalizeChecklistTool, getChecklistTool, warningTool];
const allChecklistTools = [...checklistTools, markChecklistItemAsCompleted];

export function createChecklistMiddleware(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  settings: ChecklistMiddlewareSettings,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  config: GthConfig
) {
  return Promise.resolve(
    createMiddleware({
      name: 'checklist',
      tools: allChecklistTools,
      wrapModelCall: (request, handler) => {
        const checklistState = getChecklistState();
        const baseTools = request.tools ?? [];
        if (checklistState == ChecklistState.DRAFT) {
          /**
           * Plan mode
           */
          const messages = [...request.messages, new HumanMessage(DEFAULT_PLANNING_PROMPT)];
          const tools = baseTools.filter(
            (t) =>
              (t as { gthFileSystemType?: string }).gthFileSystemType !== 'write' ||
              t.name !== CHECKLIST_COMPLETE_ITEM_TOOL_NAME
          ); // exclude write filesystem access
          setArtifact(
            TOOL_NAMES_ARTIFACT_KEY,
            tools.map((t) => t.name as string)
          );
          return handler({
            ...request,
            messages,
            tools,
          });
        } else {
          /**
           * Dev mode
           */
          const tools = baseTools.filter((t) => {
            if (typeof t.name != 'string') return true;
            const toolName = t.name as string;
            if (toolName == CHECKLIST_COMPLETE_ITEM_TOOL_NAME) return true;
            return !toolName.startsWith('gth_checklist_');
          });
          setArtifact(
            TOOL_NAMES_ARTIFACT_KEY,
            tools.map((t) => t.name as string)
          );
          return handler({
            ...request,
            tools,
          });
        }
      },
      afterModel: (state) => {
        debugLogObject('postModel state', state);
        const lastMessage = state.messages[state.messages.length - 1];
        if (
          AIMessage.isInstance(lastMessage) &&
          lastMessage.tool_calls &&
          lastMessage.tool_calls?.length > 0
        ) {
          // Gemini keeps calling default_api tools; whatever it is, we should filter them.
          // Find any tools that were not provided
          const lastCallTools: string[] = getArtifact(TOOL_NAMES_ARTIFACT_KEY) || [];
          const unexpectedToolNames = lastMessage.tool_calls
            .filter((t) => !lastCallTools.includes(t.name))
            .map((t) => t.name);
          if (unexpectedToolNames.length > 0) {
            const warning = `Unexpected tools called: [${unexpectedToolNames.join(', ')}] \n\n Available tools: [${lastCallTools.join(',')}]`;
            displayWarning(warning);
            // Only leave expected tool calls
            (state.messages[state.messages.length - 1] as AIMessage).tool_calls =
              lastMessage.tool_calls.map((t) => {
                if (!lastCallTools.includes(t.name)) {
                  return {
                    ...t,
                    name: CHECKLIST_WARNING_TOOL_NAME,
                    args: { message: `${t.name} is not a valid tool.` },
                  };
                }
                return t;
              });
            // TODO how should we let model know that tool does not exist?
            // state.messages = [...state.messages, new HumanMessage(warning)];
          }
        }
        return state;
      },
      wrapToolCall: (request, handler) => {
        // TODO this one is probably unnecessary
        console.log('ChecklistMiddleware: wrapToolCall', request?.tool?.name);
        return handler(request);
      },
      afterAgent: (state) => {
        // TODO - do something if for some reason list is not complete
        console.log('ChecklistMiddleware: afterAgent');
        console.log(getChecklist());
        return state;
      },
    })
  );
}
