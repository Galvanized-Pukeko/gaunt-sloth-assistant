import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GthConfig } from '#src/config.js';

const consoleUtilsMock = {
  display: vi.fn(),
  displayError: vi.fn(),
  displayInfo: vi.fn(),
  displayWarning: vi.fn(),
  displaySuccess: vi.fn(),
  displayDebug: vi.fn(),
  defaultStatusCallback: vi.fn(),
};
vi.mock('#src/utils/consoleUtils.js', () => consoleUtilsMock);

const llmUtilsMock = {
  getNewRunnableConfig: vi.fn().mockReturnValue({}),
  buildSystemMessages: vi.fn().mockReturnValue([]),
  readChatPrompt: vi.fn().mockReturnValue(''),
};
vi.mock('#src/utils/llmUtils.js', () => llmUtilsMock);

const memorySaverMock = vi.fn();
vi.mock('@langchain/langgraph', () => ({
  MemorySaver: memorySaverMock,
}));

const gthLangChainAgentInitMock = vi.fn();
const gthLangChainAgentStreamMock = vi.fn();
vi.mock('#src/core/GthLangChainAgent.js', () => {
  const GthLangChainAgent = vi.fn();
  GthLangChainAgent.prototype.init = gthLangChainAgentInitMock;
  GthLangChainAgent.prototype.stream = gthLangChainAgentStreamMock;
  return {
    GthLangChainAgent,
  };
});

const mockUseFn = vi.fn();
const mockPostFn = vi.fn();
const mockGetFn = vi.fn();
const mockListenFn = vi.fn();
const mockExpressApp = {
  use: mockUseFn,
  post: mockPostFn,
  get: mockGetFn,
  listen: mockListenFn,
};
const expressJsonMock = vi.fn(() => 'json-middleware');
const expressMock = Object.assign(
  vi.fn(() => mockExpressApp),
  {
    json: expressJsonMock,
  }
);
vi.mock('express', () => ({
  default: expressMock,
}));

vi.mock('@ag-ui/encoder', () => ({
  EventEncoder: vi.fn(),
}));

vi.mock('@ag-ui/core', () => ({
  EventType: {
    RUN_STARTED: 'RUN_STARTED',
    TEXT_MESSAGE_START: 'TEXT_MESSAGE_START',
    TEXT_MESSAGE_CONTENT: 'TEXT_MESSAGE_CONTENT',
    TEXT_MESSAGE_END: 'TEXT_MESSAGE_END',
    RUN_FINISHED: 'RUN_FINISHED',
    RUN_ERROR: 'RUN_ERROR',
  },
}));

vi.mock('@langchain/core/messages', () => ({
  HumanMessage: vi.fn((content: string) => ({ role: 'user', content })),
  AIMessage: vi.fn((content: string) => ({ role: 'assistant', content })),
  SystemMessage: vi.fn((content: string) => ({ role: 'system', content })),
}));

describe('apiAgUiModule', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    gthLangChainAgentInitMock.mockResolvedValue(undefined);
    mockListenFn.mockImplementation((_port: number, cb: () => void) => {
      cb();
    });
  });

  it('should use CORS values from config', async () => {
    const config = {
      commands: {
        api: {
          port: 4000,
          cors: {
            allowOrigin: 'http://example.com',
            allowMethods: 'POST, OPTIONS',
            allowHeaders: 'Content-Type',
          },
        },
      },
    } as Partial<GthConfig> as GthConfig;

    const { startAgUiServer } = await import('#src/modules/apiAgUiModule.js');
    await startAgUiServer(config, 4000);

    // The second app.use call should be the CORS middleware (first is express.json())
    expect(mockUseFn).toHaveBeenCalledTimes(2);

    const corsMiddleware = mockUseFn.mock.calls[1][0];
    const mockRes = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      end: vi.fn(),
    };
    const mockNext = vi.fn();

    // Test non-OPTIONS request
    corsMiddleware({ method: 'POST' }, mockRes, mockNext);

    expect(mockRes.setHeader).toHaveBeenCalledWith(
      'Access-Control-Allow-Origin',
      'http://example.com'
    );
    expect(mockRes.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Methods', 'POST, OPTIONS');
    expect(mockRes.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Headers', 'Content-Type');
    expect(mockNext).toHaveBeenCalled();
  });

  it('should use default CORS values when config does not specify cors', async () => {
    const config = {
      commands: {
        api: {
          port: 3000,
        },
      },
    } as Partial<GthConfig> as GthConfig;

    const { startAgUiServer } = await import('#src/modules/apiAgUiModule.js');
    await startAgUiServer(config, 3000);

    const corsMiddleware = mockUseFn.mock.calls[1][0];
    const mockRes = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      end: vi.fn(),
    };
    const mockNext = vi.fn();

    corsMiddleware({ method: 'GET' }, mockRes, mockNext);

    expect(mockRes.setHeader).toHaveBeenCalledWith(
      'Access-Control-Allow-Origin',
      'http://localhost:3000'
    );
    expect(mockRes.setHeader).toHaveBeenCalledWith(
      'Access-Control-Allow-Methods',
      'POST, GET, OPTIONS'
    );
    expect(mockRes.setHeader).toHaveBeenCalledWith(
      'Access-Control-Allow-Headers',
      'Content-Type, Accept'
    );
    expect(mockNext).toHaveBeenCalled();
  });

  it('should respond with 204 for OPTIONS requests', async () => {
    const config = {
      commands: {
        api: {
          port: 3000,
          cors: {
            allowOrigin: 'http://localhost:5000',
            allowMethods: 'POST, GET, OPTIONS',
            allowHeaders: 'Content-Type, Accept',
          },
        },
      },
    } as Partial<GthConfig> as GthConfig;

    const { startAgUiServer } = await import('#src/modules/apiAgUiModule.js');
    await startAgUiServer(config, 3000);

    const corsMiddleware = mockUseFn.mock.calls[1][0];
    const mockRes = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      end: vi.fn(),
    };
    const mockNext = vi.fn();

    corsMiddleware({ method: 'OPTIONS' }, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(204);
    expect(mockRes.end).toHaveBeenCalled();
    expect(mockNext).not.toHaveBeenCalled();
  });
});
