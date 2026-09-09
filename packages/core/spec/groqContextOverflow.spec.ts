/**
 * [[EXT-163]] — **groq's context overflow, pinned to the bytes groq actually sends.**
 *
 * `@langchain/groq` talks to `groq-sdk` directly and wraps nothing, so an overflow reaches
 * `classifyThrownTermination` as the SDK's own `BadRequestError`. Recorded live on 2026-09-10
 * against `allam-2-7b` (4096-token window — `gemma2-9b-it` is decommissioned) with `groq-sdk` 1.6.0
 * through `@langchain/groq` 1.3.1. It is **thrown**, an HTTP 400 — never a 200 with an error body:
 *
 *     {"error":{"message":"Please reduce the length of the messages or completion.",
 *               "type":"invalid_request_error","param":"messages"}}
 *
 * **There is no structural signal in it.** The body carries no `code` — so `context_length_exceeded`,
 * the arm an OpenAI-compatible API was expected to hit, never sees it — `type` is the
 * `invalid_request_error` every groq 400 carries, and `param: 'messages'` was not measured to be
 * specific to overflow. The ONLY thing that classifies it is the prose arm
 * `'reduce the length of the messages'` in `CONTEXT_OVERFLOW_PATTERNS`: OpenAI's trailing sentence,
 * which groq reuses as its whole message. OpenAI's own message also matches
 * `'maximum context length'`, so that arm is load-bearing for groq alone — dedupe it as redundant
 * and a groq overflow silently becomes `invalid_request`, which the runner never compacts. The cells
 * here are what turns that removal red.
 *
 * The fixtures are built with the SDK's real error classes, reached through the client `ChatGroq`
 * constructs (a dependency this package already carries) rather than a phantom `groq-sdk` import, so
 * the shape under test is the SDK constructor's and not a hand-drawn imitation of it. No request is
 * ever made: the API key is a placeholder and the only client method used is stubbed.
 */
import { describe, expect, it } from 'vitest';
import { ContextOverflowError } from '@langchain/core/errors';
import type { AIMessageChunk } from '@langchain/core/messages';
import { ChatGroq } from '@langchain/groq';
import { classifyThrownTermination, isContextOverflow } from '#src/core/terminationReason.js';
import { detectOutputTruncation, readStopReasonToken } from '#src/core/refusal.js';

type GroqErrorBody = { error: Record<string, unknown> };
type GroqApiError = Error & { status: number; error: GroqErrorBody };
type GroqErrorCtor = new (
  status: number,
  body: GroqErrorBody,
  message: string | undefined,
  headers: Headers
) => GroqApiError;
type GroqErrorClasses = Record<
  'BadRequestError' | 'RateLimitError' | 'AuthenticationError',
  GroqErrorCtor
>;

/** A client that never sends: placeholder key, no retries. */
function groqClient(streaming = false): ChatGroq {
  return new ChatGroq({ apiKey: 'stub-never-sent', model: 'allam-2-7b', maxRetries: 0, streaming });
}

/** The SDK's own error classes hang off the client class, the way every Stainless SDK exposes them. */
function groqErrorClasses(): GroqErrorClasses {
  const client = groqClient().client as unknown as { constructor: GroqErrorClasses };
  return client.constructor;
}

/** The response headers the live call carried, reduced to the two that identify the provider. */
function headers(): Headers {
  return new Headers({ 'x-request-id': 'req_redacted', 'x-groq-region': 'redacted' });
}

/** Recorded 2026-09-10 — the overflow. */
const RECORDED_OVERFLOW: GroqErrorBody = {
  error: {
    message: 'Please reduce the length of the messages or completion.',
    type: 'invalid_request_error',
    param: 'messages',
  },
};

/** Recorded 2026-09-10 — an ordinary groq 400: the model the node named no longer exists. */
const RECORDED_DECOMMISSIONED: GroqErrorBody = {
  error: {
    message:
      'The model `gemma2-9b-it` has been decommissioned and is no longer supported. Please refer ' +
      'to https://console.groq.com/docs/deprecations for a recommendation on which model to use ' +
      'instead.',
    type: 'invalid_request_error',
    code: 'model_decommissioned',
  },
};

describe('[[EXT-163]] groq context overflow — the recorded 400', () => {
  const { BadRequestError } = groqErrorClasses();
  const recorded = (): GroqApiError =>
    new BadRequestError(400, RECORDED_OVERFLOW, undefined, headers());

  it('arrives as the SDK error, untyped: no class, no name, no code, no lc_error_code', () => {
    const error = recorded();
    // The SDK constructor reproduces the live throw byte for byte, message included.
    expect(error.message).toBe(
      '400 {"error":{"message":"Please reduce the length of the messages or completion.",' +
        '"type":"invalid_request_error","param":"messages"}}'
    );
    expect(error.status).toBe(400);
    expect(error.name).toBe('Error');
    expect(ContextOverflowError.isInstance(error)).toBe(false);
    expect((error as { lc_error_code?: string }).lc_error_code).toBeUndefined();
    expect(RECORDED_OVERFLOW.error.code).toBeUndefined();
  });

  it('is classified as a context overflow', () => {
    const error = recorded();
    expect(isContextOverflow(error)).toBe(true);
    expect(classifyThrownTermination(error).category).toBe('context_overflow');
  });

  it('is classified from the nested envelope alone when the top-level message is not the carrier', () => {
    // A re-wrap that replaces the message leaves the body on `error`; the reader follows
    // `error.error.message`, which is where groq puts the sentence.
    const rewrapped = Object.assign(new Error('Stream processing failed'), {
      status: 400,
      error: RECORDED_OVERFLOW,
    });
    expect(isContextOverflow(rewrapped)).toBe(true);
    expect(classifyThrownTermination(rewrapped).category).toBe('context_overflow');
  });

  it('is carried by the sentence and nothing else — the same 400 reworded is an invalid request', () => {
    // Same status, same type, same param: only the prose differs. This is the cell that names the
    // arm, because nothing structural in the body could have decided the cell above.
    const reworded = new BadRequestError(
      400,
      {
        error: {
          message: 'Please shorten the conversation.',
          type: 'invalid_request_error',
          param: 'messages',
        },
      },
      undefined,
      headers()
    );
    expect(isContextOverflow(reworded)).toBe(false);
    expect(classifyThrownTermination(reworded)).toEqual({
      category: 'invalid_request',
      detail: '400',
    });
  });
});

describe('[[EXT-163]] the arm is load-bearing for groq alone', () => {
  it("OpenAI's wording, which the sentence was lifted from, still classifies without it", () => {
    // OpenAI's message says "maximum context length" before it says "reduce the length of the
    // messages", so a reader who sees both arms match it may call the trailing one redundant. With
    // the sentence stripped OpenAI still classifies — through the other arm — and groq, whose whole
    // message IS the sentence, has no other arm to fall to. That is the surviving control for the
    // removal the cells above go red on.
    const openaiWithoutTheSentence = Object.assign(
      new Error("This model's maximum context length is 8192 tokens. However, you requested 9001."),
      { status: 400 }
    );
    expect(isContextOverflow(openaiWithoutTheSentence)).toBe(true);
  });
});

describe('[[EXT-163]] ordinary groq errors are not overflows', () => {
  const { BadRequestError, RateLimitError, AuthenticationError } = groqErrorClasses();

  it('the recorded model_decommissioned 400 is an invalid request', () => {
    const error = new BadRequestError(400, RECORDED_DECOMMISSIONED, undefined, headers());
    expect(isContextOverflow(error)).toBe(false);
    expect(classifyThrownTermination(error)).toEqual({
      category: 'invalid_request',
      detail: '400',
    });
  });

  it.each([
    ['a 429 RateLimitError', RateLimitError, 429, 'rate_limited'],
    ['a 401 AuthenticationError', AuthenticationError, 401, 'auth_failed'],
  ] as const)(
    '%s is classified by its status, never as an overflow',
    (_label, Ctor, status, category) => {
      // The class is the one the SDK's own factory selects for that status; the body prose is
      // illustrative, because the status arm decides before any text is read.
      const error = new Ctor(
        status,
        { error: { message: 'request refused', type: 'invalid_request_error' } },
        undefined,
        headers()
      );
      expect(isContextOverflow(error)).toBe(false);
      expect(classifyThrownTermination(error).category).toBe(category);
    }
  );
});

describe('[[EXT-163]] groq output truncation — finish_reason reaches the metadata feeder', () => {
  // The wrapper writes `finish_reason` into `generationInfo`, not the message; it is
  // `@langchain/core` that merges it into `response_metadata` on both paths. These cells drive the
  // real wrapper over a stubbed SDK client, so a wrapper bump that stops recording the reason — or a
  // core bump that stops merging it — is what goes red here, separately from the thrown-error path.
  const completion = (finish_reason: string) => ({
    id: 'chatcmpl-stub',
    object: 'chat.completion',
    created: 1,
    model: 'allam-2-7b',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'cut off mid' },
        finish_reason,
        logprobs: null,
      },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 },
    system_fingerprint: 'fp_stub',
  });
  const chunks = (finish_reason: string) => [
    {
      id: 'chatcmpl-stub',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'allam-2-7b',
      choices: [
        { index: 0, delta: { role: 'assistant', content: 'cut off' }, finish_reason: null },
      ],
    },
    {
      id: 'chatcmpl-stub',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'allam-2-7b',
      choices: [{ index: 0, delta: { content: ' mid' }, finish_reason }],
      x_groq: { usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 } },
    },
  ];

  function stubbedGroq(streaming: boolean, finish_reason: string): ChatGroq {
    const llm = groqClient(streaming);
    const client = llm.client as unknown as {
      chat: { completions: { create: (request: { stream?: boolean }) => Promise<unknown> } };
    };
    client.chat.completions.create = async (request) =>
      request.stream
        ? (async function* () {
            yield* chunks(finish_reason);
          })()
        : completion(finish_reason);
    return llm;
  }

  it('on invoke: finish_reason: length lands in response_metadata and classifies as output_truncated', async () => {
    const message = await stubbedGroq(false, 'length').invoke('hi');
    expect(message.response_metadata.finish_reason).toBe('length');
    expect(readStopReasonToken(message)).toBe('length');
    expect(detectOutputTruncation(message)).toEqual({
      category: 'output_truncated',
      detail: 'length',
    });
  });

  it('on stream: the aggregated chunk carries it too', async () => {
    let aggregated: AIMessageChunk | undefined;
    for await (const chunk of await stubbedGroq(true, 'length').stream('hi')) {
      aggregated = aggregated ? aggregated.concat(chunk) : chunk;
    }
    expect(aggregated?.response_metadata.finish_reason).toBe('length');
    expect(detectOutputTruncation(aggregated)).toEqual({
      category: 'output_truncated',
      detail: 'length',
    });
  });

  it('a normal stop is not a truncation', async () => {
    const message = await stubbedGroq(false, 'stop').invoke('hi');
    expect(readStopReasonToken(message)).toBe('stop');
    expect(detectOutputTruncation(message)).toBeNull();
  });
});
