/**
 * [[EXT-162]] — **Gemini's context overflow, pinned to the bytes Google actually sends.**
 *
 * `@langchain/google` maps no context overflow: it defines `GoogleError`, `RequestError` and
 * friends, and stamps `ContextOverflowError` on nothing. So an oversized input reaches
 * `classifyThrownTermination` as the package's own `RequestError` — an HTTP 400, thrown, never a
 * 200 with an error body. Recorded live on 2026-09-12 against AI Studio through
 * `@langchain/google` 0.2.3, on two models with different windows (`gemini-3.8-flash`, 1048576
 * tokens, and `gemini-2.5-flash-image`, 32768). The whole body is:
 *
 *     {"error":{"code":400,
 *               "message":"The input token count exceeds the maximum number of tokens allowed (1048576).",
 *               "status":"INVALID_ARGUMENT"}}
 *
 * **Nothing structural is available to classify it.** `code: 400` and `status: 'INVALID_ARGUMENT'`
 * are byte for byte what a rejected API key returns from the same endpoint — that body is recorded
 * below as a control — so the prose is the only carrier, and the arm
 * `'exceeds the maximum number of tokens allowed'` in `CONTEXT_OVERFLOW_PATTERNS` is the only thing
 * that classifies a Gemini overflow. Before it existed the 400 classified as `invalid_request`,
 * whose remedy is not `reduce-context`, so the [[EXT-160]] compact-and-retry seam never saw it.
 *
 * **The two halves of this node are not in the same state, and the cells reflect that.** The thrown
 * path needed the arm above. The `MAX_TOKENS` metadata path already worked end to end before this
 * node — `refusal.ts` reads camelCase `finishReason` off the same shelf — so the cells for it are
 * *pinning* what was measured, not covering something new.
 *
 * **VERTEX IS NOT COVERED HERE, and the gap is narrower than "the envelope".** From the package's
 * code, `BaseChatGoogle` reaches both platforms through one `apiClient.fetch(...)` and one
 * `throw await RequestError.fromResponse(response)`; the only platform branch is `buildUrl` (host,
 * api version, auth). So the class, the status, the `data` body and the
 * `message = errorBody.error.message` derivation are shared by construction, and the one thing
 * nobody here has seen is the **sentence the Vertex endpoint puts in `error.message`** — because
 * this machine has no Vertex credential (no ADC, no service account, no project) to make the call
 * with. No fixture is invented for it: a detector fitted to a guessed wording would read as covered
 * and would not be.
 *
 * **How the fixtures are driven.** Each cell replaces `apiClient.fetch` on a real `ChatGoogle` with
 * one that answers from the recorded bytes, so the real `RequestError.fromResponse` builds the real
 * class and the real converters build the real message — the shape under test is the package's own,
 * not a hand-drawn imitation. No request is ever made: the api key is an explicit placeholder (so
 * the ambient `GOOGLE_API_KEY` is never read), and every cell asserts the stub was called, which
 * makes a stub that failed to install a red rather than a live network call on a CI cell.
 */
import { describe, expect, it } from 'vitest';
import { ContextOverflowError } from '@langchain/core/errors';
import type { AIMessageChunk } from '@langchain/core/messages';
import { ChatGoogle } from '@langchain/google/node';
import { classifyThrownTermination, isContextOverflow } from '#src/core/terminationReason.js';
import { detectOutputTruncation, readStopReasonToken } from '#src/core/refusal.js';

/** Recorded 2026-09-12 — the overflow on the curated default model (window 1048576). */
const RECORDED_OVERFLOW_FLASH = {
  error: {
    code: 400,
    message: 'The input token count exceeds the maximum number of tokens allowed (1048576).',
    status: 'INVALID_ARGUMENT',
  },
};

/**
 * Recorded 2026-09-12 — the same overflow on a model with a 32768-token window. Two windows, one
 * wording: the sentence is the API's, not the model's.
 */
const RECORDED_OVERFLOW_SMALL_WINDOW = {
  error: {
    code: 400,
    message: 'The input token count exceeds the maximum number of tokens allowed (32768).',
    status: 'INVALID_ARGUMENT',
  },
};

/**
 * Recorded 2026-09-12 — a deliberately corrupted key. The control that proves the classification
 * above cannot have come from anything structural: same status, same `code`, same
 * `status: 'INVALID_ARGUMENT'`, different sentence.
 */
const RECORDED_AUTH_FAILURE = {
  error: {
    code: 400,
    message: 'API key not valid. Please pass a valid API key.',
    status: 'INVALID_ARGUMENT',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
        reason: 'API_KEY_INVALID',
        domain: 'googleapis.com',
        metadata: { service: 'generativelanguage.googleapis.com' },
      },
      {
        '@type': 'type.googleapis.com/google.rpc.LocalizedMessage',
        locale: 'en-US',
        message: 'API key not valid. Please pass a valid API key.',
      },
    ],
  },
};

/**
 * Recorded 2026-09-12 — a real 429. The probes that captured the overflow above crossed the
 * input-tokens-per-minute quota, which is what produced it.
 */
const RECORDED_QUOTA_429 = {
  error: {
    code: 429,
    message:
      'You exceeded your current quota, please check your plan and billing details. For more ' +
      'information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. To ' +
      'monitor your current usage, head to: https://ai.dev/rate-limit. \n* Quota exceeded for ' +
      'metric: generativelanguage.googleapis.com/generate_content_paid_tier_2_input_token_count, ' +
      'limit: 3000000, model: gemini-3.8-flash\nPlease retry in 51.386192716s.',
    status: 'RESOURCE_EXHAUSTED',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
        violations: [
          {
            quotaMetric:
              'generativelanguage.googleapis.com/generate_content_paid_tier_2_input_token_count',
            quotaId: 'GenerateContentPaidTierInputTokensPerModelPerMinute-PaidTier2',
            quotaDimensions: { location: 'global', model: 'gemini-3.8-flash' },
            quotaValue: '3000000',
          },
        ],
      },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '14s' },
    ],
  },
};

/** Recorded 2026-09-12 — an unknown model id, the ordinary 404 of this API. */
const RECORDED_MODEL_NOT_FOUND = {
  error: {
    code: 404,
    message:
      'models/gemini-does-not-exist-ext162 is not found for API version v1beta, or is not ' +
      'supported for generateContent. Call ModelService.ListModels to see the list of available ' +
      'models and their supported methods.',
    status: 'NOT_FOUND',
  },
};

/**
 * Recorded 2026-09-12 — a real output truncation, `maxOutputTokens: 6`. The API supplies
 * **camelCase `finishReason` only**; the snake_case twin the reader also accepts is
 * `@langchain/core`'s normalisation, added on the way through.
 */
const RECORDED_MAX_TOKENS_200 = {
  candidates: [{ content: {}, finishReason: 'MAX_TOKENS', index: 0 }],
  usageMetadata: {
    promptTokenCount: 20,
    totalTokenCount: 23,
    promptTokensDetails: [{ modality: 'TEXT', tokenCount: 20 }],
    thoughtsTokenCount: 3,
    serviceTier: 'standard',
  },
  modelVersion: 'gemini-3.8-flash',
  responseId: 'vWykav6bOqTCg8UPpLWH4QE',
};

/**
 * Recorded 2026-09-12 — an ordinary completed answer. The `thoughtSignature` is the model's own
 * opaque per-response artifact, kept verbatim rather than tidied: editing recorded bytes is how the
 * streaming fixture below first went wrong.
 */
const RECORDED_STOP_200 = {
  candidates: [
    {
      content: {
        parts: [
          {
            text: 'OK',
            thoughtSignature:
              'EmcKZQERTTIP5pE017nblhA/4mZVXvZl+TCPfM3+4VB72hh67aW8MmMMKkqCljfTnqTzlUEjjNwVGKSw' +
              'ULz4QsbFMVhNB/jY+u97vw5M+mxHROgnqff7BHMf0cZtouc4DxQl7eCn+XwP',
          },
        ],
        role: 'model',
      },
      finishReason: 'STOP',
      index: 0,
    },
  ],
  usageMetadata: {
    promptTokenCount: 6,
    candidatesTokenCount: 1,
    totalTokenCount: 7,
    promptTokensDetails: [{ modality: 'TEXT', tokenCount: 6 }],
    serviceTier: 'standard',
  },
  modelVersion: 'gemini-3.8-flash',
  responseId: 'km2kaorlCeDdg8UP67-l6Ac',
};

/**
 * Recorded 2026-09-12 — the streaming form of the same truncation, verbatim as
 * `streamGenerateContent?alt=sse` sent it. The reason arrives on the **last** event only, which is
 * why the aggregated chunk is what the cell reads.
 *
 * **The terminating blank line is load-bearing, and a fixture missing it fails in the reassuring
 * direction.** `eventsource-parser` dispatches an event when it sees the blank line that ends it,
 * so a body that simply stops after the last `data:` drops that event — silently, leaving a stream
 * that looks complete and carries no `finishReason` at all. That is indistinguishable from the
 * provider never sending one, and it is why this cell is written against a live-verified fact: a
 * real streamed turn with a tiny output cap does carry `MAX_TOKENS` on its final chunk.
 */
const RECORDED_MAX_TOKENS_SSE =
  [
    'data: {"candidates": [{"content": {"parts": [{"text": "### Two"}],"role": "model"},"index": 0}],"usageMetadata": {"promptTokenCount": 20,"candidatesTokenCount": 2,"totalTokenCount": 22,"promptTokensDetails": [{"modality": "TEXT","tokenCount": 20}],"serviceTier": "standard"},"modelVersion": "gemini-3.8-flash","responseId": "k22kauewLpKzg8UP-_Os-AY"}',
    'data: {"candidates": [{"content": {"parts": [{"text": " Wheels to"}],"role": "model"},"index": 0}],"usageMetadata": {"promptTokenCount": 20,"candidatesTokenCount": 4,"totalTokenCount": 24,"promptTokensDetails": [{"modality": "TEXT","tokenCount": 20}],"serviceTier": "standard"},"modelVersion": "gemini-3.8-flash","responseId": "k22kauewLpKzg8UP-_Os-AY"}',
    'data: {"candidates": [{"content": {"parts": [{"text": "","thoughtSignature": "EmcKZQERTTIP3XgdOjfcfk6RoBGnDZ9aGnO2vfHecLcvL49HTiYY33N44kpOQ/gb81GOvIigJD3Lo3IjkNUGDr6dSlcASIDyG9juGbcIcfpmLbIET9VD/0JhtBnGu5JzRkk1rs6ML2zP"}],"role": "model"},"finishReason": "MAX_TOKENS","index": 0}],"usageMetadata": {"promptTokenCount": 20,"candidatesTokenCount": 4,"totalTokenCount": 24,"promptTokensDetails": [{"modality": "TEXT","tokenCount": 20}],"serviceTier": "standard"},"modelVersion": "gemini-3.8-flash","responseId": "k22kauewLpKzg8UP-_Os-AY"}',
  ].join('\n\n') + '\n\n';

/** A real `ChatGoogle` that can never reach the network: an explicit placeholder key, no retries. */
function googleModel(): ChatGoogle {
  // The api key is passed rather than omitted on purpose — the constructor falls back to the
  // ambient GOOGLE_API_KEY, and a spec must never pick up a live credential.
  return new ChatGoogle({ model: 'gemini-3.8-flash', apiKey: 'stub-never-sent', maxRetries: 0 });
}

interface TransportHolder {
  apiClient: { fetch: (request: Request) => Promise<Response> };
}

/**
 * Answer this model's next request from recorded bytes. Returns the call counter, so every cell can
 * assert the transport really was replaced instead of trusting that it was.
 */
function stubTransport(
  llm: ChatGoogle,
  init: { status: number; statusText: string; body: unknown; contentType?: string }
): { count: number } {
  const calls = { count: 0 };
  const payload = typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
  (llm as unknown as TransportHolder).apiClient.fetch = async () => {
    calls.count += 1;
    return new Response(payload, {
      status: init.status,
      statusText: init.statusText,
      headers: { 'content-type': init.contentType ?? 'application/json' },
    });
  };
  return calls;
}

/** Drive a recorded error response through the real model and return what it threw. */
async function thrownFor(
  body: unknown,
  status: number,
  statusText: string,
  path: 'invoke' | 'stream' = 'invoke'
): Promise<unknown> {
  const llm = googleModel();
  const calls = stubTransport(llm, { status, statusText, body });
  let caught: unknown = undefined;
  let threw = false;
  try {
    if (path === 'stream') {
      for await (const chunk of await llm.stream('hi')) {
        expect(chunk).toBeDefined();
      }
    } else {
      await llm.invoke('hi');
    }
  } catch (error) {
    threw = true;
    caught = error;
  }
  expect(calls.count).toBe(1);
  expect(threw).toBe(true);
  return caught;
}

describe('[[EXT-162]] google context overflow — the recorded 400', () => {
  it('arrives as RequestError, untyped: no ContextOverflowError, no lc_error_code', async () => {
    const error = (await thrownFor(RECORDED_OVERFLOW_FLASH, 400, 'Bad Request')) as {
      name: string;
      statusCode: number;
      message: string;
      data: unknown;
      lc_error_code?: string;
    };
    // `RequestError.fromResponse` lifts `error.message` out of the body, so the recorded sentence
    // is both the top-level message and the nested one.
    expect(error.name).toBe('RequestError');
    expect(error.statusCode).toBe(400);
    expect(error.message).toBe(
      'The input token count exceeds the maximum number of tokens allowed (1048576).'
    );
    expect(error.data).toEqual(RECORDED_OVERFLOW_FLASH);
    expect(ContextOverflowError.isInstance(error)).toBe(false);
    expect(error.lc_error_code).toBeUndefined();
  });

  it('is classified as a context overflow', async () => {
    const error = await thrownFor(RECORDED_OVERFLOW_FLASH, 400, 'Bad Request');
    expect(isContextOverflow(error)).toBe(true);
    // The detail is the error's own name, which for this package is never `ContextOverflowError`.
    expect(classifyThrownTermination(error)).toEqual({
      category: 'context_overflow',
      detail: 'RequestError',
    });
  });

  it('is classified on the streaming path too, which is the path the runner uses', async () => {
    const error = await thrownFor(RECORDED_OVERFLOW_FLASH, 400, 'Bad Request', 'stream');
    expect((error as { name: string }).name).toBe('RequestError');
    expect(isContextOverflow(error)).toBe(true);
    expect(classifyThrownTermination(error).category).toBe('context_overflow');
  });

  it('is classified on a model with a different window, from the same sentence', async () => {
    const error = await thrownFor(RECORDED_OVERFLOW_SMALL_WINDOW, 400, 'Bad Request');
    expect(isContextOverflow(error)).toBe(true);
    expect(classifyThrownTermination(error).category).toBe('context_overflow');
  });

  it('is classified from the nested envelope alone when a wrapper replaced the message', async () => {
    // What the runner's own re-wraps look like: the prose is gone from `message` and the recorded
    // body is still on `data`, which is where the reader follows it.
    const rewrapped = Object.assign(new Error('Agent processing failed'), {
      statusCode: 400,
      data: RECORDED_OVERFLOW_FLASH,
    });
    expect(isContextOverflow(rewrapped)).toBe(true);
    expect(classifyThrownTermination(rewrapped).category).toBe('context_overflow');
  });

  it('is carried by the sentence and nothing else — the same 400 reworded is an invalid request', async () => {
    // Identical status, identical `code`, identical `status`: only the prose differs. This is the
    // cell that names the arm, because nothing structural in the recorded body could have decided
    // any cell above.
    const error = await thrownFor(
      {
        error: {
          code: 400,
          message: 'The request was too big for this model.',
          status: 'INVALID_ARGUMENT',
        },
      },
      400,
      'Bad Request'
    );
    expect(isContextOverflow(error)).toBe(false);
    expect(classifyThrownTermination(error)).toEqual({
      category: 'invalid_request',
      detail: '400',
    });
  });
});

describe('[[EXT-162]] the arm is the tail of the sentence, not its head', () => {
  it('an inline token count does not break the match', () => {
    // SYNTHETIC, and deliberately so: this string is the recorded message with a count spliced in
    // (1246756 is what `countTokens` reported for the payload that produced the recorded 400). It
    // asserts nothing about what Google emits — it pins the CHOICE of substring, which is the one
    // decision in this node a reviewer cannot re-derive from the fixtures. Anchor the arm on the
    // head instead ('input token count exceeds') and every recorded cell above stays green while
    // this one goes red.
    const withInlineCount = RECORDED_OVERFLOW_FLASH.error.message.replace(
      'The input token count exceeds',
      'The input token count (1246756) exceeds'
    );
    expect(withInlineCount).not.toBe(RECORDED_OVERFLOW_FLASH.error.message);
    expect(isContextOverflow(Object.assign(new Error(withInlineCount), { statusCode: 400 }))).toBe(
      true
    );
  });
});

describe('[[EXT-162]] ordinary google errors are not overflows', () => {
  it('the recorded invalid-key 400 is an auth failure', async () => {
    const error = await thrownFor(RECORDED_AUTH_FAILURE, 400, 'Bad Request');
    expect(isContextOverflow(error)).toBe(false);
    expect(classifyThrownTermination(error).category).toBe('auth_failed');
  });

  it('the recorded quota 429 is rate limiting', async () => {
    const error = await thrownFor(RECORDED_QUOTA_429, 429, 'Too Many Requests');
    expect(isContextOverflow(error)).toBe(false);
    expect(classifyThrownTermination(error)).toEqual({ category: 'rate_limited', detail: '429' });
  });

  it('the recorded unknown-model 404 is not an overflow', async () => {
    // Only the overflow claim is asserted. Which category a 404 lands in is not this node's
    // business, and pinning it here would red on an unrelated improvement to that arm.
    const error = await thrownFor(RECORDED_MODEL_NOT_FOUND, 404, 'Not Found');
    expect(isContextOverflow(error)).toBe(false);
    expect(classifyThrownTermination(error).category).not.toBe('context_overflow');
  });
});

describe('[[EXT-162]] gemini output truncation — MAX_TOKENS reaches the metadata feeder', () => {
  // Asserted separately from the thrown-error path, and for a different reason: this half already
  // worked. `refusal.ts` reads camelCase `finishReason`, which is the spelling the API supplies, so
  // these cells pin a path rather than cover a new one. They drive the real wrapper over recorded
  // bytes, so a package bump that stops recording the reason — or a core bump that stops merging it
  // into `response_metadata` — is what goes red.
  it('on invoke: finishReason: MAX_TOKENS lands in response_metadata and classifies as output_truncated', async () => {
    const llm = googleModel();
    const calls = stubTransport(llm, {
      status: 200,
      statusText: 'OK',
      body: RECORDED_MAX_TOKENS_200,
    });
    const message = await llm.invoke('hi');
    expect(calls.count).toBe(1);
    expect(message.response_metadata.finishReason).toBe('MAX_TOKENS');
    expect(message.additional_kwargs.finishReason).toBe('MAX_TOKENS');
    expect(readStopReasonToken(message)).toBe('max_tokens');
    expect(detectOutputTruncation(message)).toEqual({
      category: 'output_truncated',
      detail: 'max_tokens',
    });
  });

  it('on stream: the aggregated chunk carries it too', async () => {
    const llm = googleModel();
    const calls = stubTransport(llm, {
      status: 200,
      statusText: 'OK',
      body: RECORDED_MAX_TOKENS_SSE,
      contentType: 'text/event-stream',
    });
    let aggregated: AIMessageChunk | undefined;
    let chunks = 0;
    for await (const chunk of await llm.stream('hi')) {
      chunks += 1;
      aggregated = aggregated ? aggregated.concat(chunk) : chunk;
    }
    expect(calls.count).toBe(1);
    // All three recorded events, the last one included: a stream that ends one event early is the
    // failure mode the fixture's framing guards against, and it would otherwise read as a missing
    // `finishReason` rather than as a broken fixture.
    expect(chunks).toBe(3);
    expect(aggregated?.response_metadata.finishReason).toBe('MAX_TOKENS');
    expect(readStopReasonToken(aggregated)).toBe('max_tokens');
    expect(detectOutputTruncation(aggregated)).toEqual({
      category: 'output_truncated',
      detail: 'max_tokens',
    });
  });

  it('a completed answer is not a truncation, and not an overflow either', async () => {
    const llm = googleModel();
    const calls = stubTransport(llm, { status: 200, statusText: 'OK', body: RECORDED_STOP_200 });
    const message = await llm.invoke('hi');
    expect(calls.count).toBe(1);
    expect(readStopReasonToken(message)).toBe('stop');
    expect(detectOutputTruncation(message)).toBeNull();
  });
});
