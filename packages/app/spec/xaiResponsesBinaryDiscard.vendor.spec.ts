/**
 * CFG-63 — a VENDOR-BEHAVIOUR PIN, not a test of gth code.
 *
 * `binaryContentInjectionMiddleware` refuses to send a non-image attachment to `xai-responses`
 * because `@langchain/xai`'s Responses converter discards it: its human-message branch recognises
 * `text` and `image_url` and rewrites every other part to `{ type:'input_text', text:'' }`, so the
 * request is built as though nothing were attached and the model answers about content it never
 * received. That refusal is only correct while the vendor still behaves that way.
 *
 * **A failure here means @langchain/xai CHANGED — it does not mean gth broke.** The likely change is
 * a good one: xAI growing a real branch for file/audio parts, or rejecting an unrecognised part
 * instead of silently emptying it. Either way the response is to re-measure and revisit
 * `nonImageBinaryFateFor`'s `xai-responses` arm (it may become `delivered-or-loud`, dropping the
 * refusal), NOT to relax this assertion so the suite goes quiet again. The whole point of pinning a
 * third party's current behaviour is that its change arrives as a red cell rather than as a silent
 * shift underneath a decision that depended on it.
 *
 * Two vendor facts are pinned here, and the first one is NOT CFG-63's alone: the provider label
 * `_llmType()` reports, which both CFG-63's refusal arm and CFG-45's `imageBlockFor` arm key on
 * (see that cell), and the converter's discard behaviour itself.
 *
 * Hermetic: `globalThis.fetch` is replaced with a stub that captures the request body and throws
 * before anything is sent. No network, no API key, no vendor call. The middleware's own half of this
 * is pinned in `packages/agent/spec/binaryContentInjectionMiddleware.spec.ts`.
 *
 * This spec lives in `packages/app` because that is the package which declares `@langchain/xai`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HumanMessage } from '@langchain/core/messages';
import { ChatXAIResponses } from '@langchain/xai';

/** The exact block `createContentBlock()` emits for a non-image attachment. */
const PDF_BLOCK = {
  type: 'file',
  source_type: 'base64',
  mime_type: 'application/pdf',
  data: 'JVBERi0xLjQKQ0ZHLTYz',
  metadata: { filename: 'q3-results.pdf' },
};

const PREAMBLE = 'Here is the file content from the file:';

class CapturedRequest extends Error {}

/** Install a fetch stub that records the outgoing request and refuses to send it. */
function captureFetch(): { last: () => { url: string; body: string } | undefined } {
  let last: { url: string; body: string } | undefined;
  vi.stubGlobal('fetch', async (input: unknown, init?: { body?: unknown }) => {
    const url = String((input as { url?: string })?.url ?? input);
    last = { url, body: typeof init?.body === 'string' ? init.body : String(init?.body) };
    throw new CapturedRequest('vendor pin: request captured, not sent');
  });
  return { last: () => last };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('VENDOR PIN — @langchain/xai Responses converter (a red here means xAI CHANGED, not gth)', () => {
  it('still reports the provider label BOTH arms key on: _llmType() === "xai-responses"', () => {
    // THE STRING THAT CONNECTS THE VENDOR TO EVERY DECISION BELOW, and the only thing pinning it.
    //
    // `resolveVisionProvider` (`packages/agent/src/middleware/registry.ts`) falls back to
    // `llm._llmType()`, so this literal is the label that reaches BOTH per-provider switches:
    //
    //   1. CFG-63 — `nonImageBinaryFateFor`'s `case 'xai-responses'` in
    //      `packages/agent/src/middleware/binaryContentInjectionMiddleware.ts`, which returns
    //      `silently-discarded` and is what makes the middleware refuse a non-image attachment.
    //   2. CFG-45 — `imageBlockFor`'s `case 'xai-responses'` in
    //      `packages/agent/src/middleware/frontendImageInjectionMiddleware.ts`, which returns the
    //      `image_url` block this converter needs instead of the standard base64 block.
    //
    // Neither switch can match a label the vendor no longer emits. If xAI renames it, both arms fall
    // to their `default`: CFG-63's refusal silently stops firing and the user is back to a confident
    // answer about a file the model never received, and CFG-45's images fall to the standard block
    // this same converter destroys. Measured: renaming this return value leaves every OTHER cell in
    // the repo green, so without this line the rename is invisible.
    //
    // **A red here means xAI RENAMED the label — it does not mean gth broke.** The fix is to update
    // both `case` labels to the vendor's new string (and this assertion), NOT to delete the
    // assertion so the suite goes quiet.
    const model = new ChatXAIResponses({ apiKey: 'cfg63-not-a-real-key', model: 'grok-4' });
    expect(model._llmType()).toBe('xai-responses');
  });

  it('still SILENTLY DISCARDS a non-image block, rewriting it to an empty input_text part', async () => {
    const captured = captureFetch();
    const model = new ChatXAIResponses({
      apiKey: 'cfg63-not-a-real-key',
      model: 'grok-4',
      // No retries: the stub's throw looks like a transport failure to LangChain's AsyncCaller, and
      // the default six retries with backoff would make this cell a 10s timeout rather than a test.
      maxRetries: 0,
    });

    await expect(
      model.invoke([new HumanMessage({ content: [{ type: 'text', text: PREAMBLE }, PDF_BLOCK] })])
    ).rejects.toThrow();

    const request = captured.last();
    // A request was BUILT. If a future version rejects the unrecognised part instead of emptying
    // it, the converter throws before fetch is reached and this is undefined — which is the whole
    // behaviour change this cell exists to surface.
    expect(request).toBeDefined();
    expect(request!.url).toContain('/responses');

    const payload = JSON.parse(request!.body) as {
      input: Array<{ role: string; content: Array<Record<string, unknown>> }>;
    };
    const userTurn = payload.input.find((item) => item.role === 'user');
    expect(userTurn?.content).toEqual([
      { type: 'input_text', text: PREAMBLE },
      // The attachment. Everything about it is gone: type, mime, filename, and the bytes.
      { type: 'input_text', text: '' },
    ]);

    // Not implied by the assertion above, and the one that actually matters: the payload does not
    // survive ANYWHERE in the request — not in a sibling field, not in an attachments array. This is
    // what makes the discard total rather than merely misplaced.
    expect(request!.body).not.toContain(PDF_BLOCK.data);
  });

  it('CONTROL — an image_url part still reaches the vendor as a real input_image item', async () => {
    // The counterpart CFG-45 established, kept here so the cell above is discriminating rather than
    // just pessimistic: this converter is not broken, it simply has no branch for non-image media.
    // If this one reds too, the failure is the harness (or the class), not the discard behaviour.
    const captured = captureFetch();
    const model = new ChatXAIResponses({
      apiKey: 'cfg63-not-a-real-key',
      model: 'grok-4',
      // No retries: the stub's throw looks like a transport failure to LangChain's AsyncCaller, and
      // the default six retries with backoff would make this cell a 10s timeout rather than a test.
      maxRetries: 0,
    });
    const dataUrl = `data:image/png;base64,${PDF_BLOCK.data}`;

    await expect(
      model.invoke([
        new HumanMessage({
          content: [
            { type: 'text', text: PREAMBLE },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        }),
      ])
    ).rejects.toThrow();

    const payload = JSON.parse(captured.last()!.body) as {
      input: Array<{ role: string; content: Array<Record<string, unknown>> }>;
    };
    const userTurn = payload.input.find((item) => item.role === 'user');
    expect(userTurn?.content).toEqual([
      { type: 'input_text', text: PREAMBLE },
      { type: 'input_image', image_url: dataUrl, detail: 'auto' },
    ]);
  });
});
