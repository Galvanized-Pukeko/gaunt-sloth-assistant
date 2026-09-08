/**
 * GS2-75 — unit tests for the default-on binary-content-injection middleware.
 *
 * The middleware turns a `gth_read_binary` ToolMessage into a HumanMessage carrying a content block
 * the target provider can decode. These tests pin the per-provider IMAGE block shape (the GS2-75 fix:
 * route the image case through `imageBlockFor` so OpenAI reasoning models on the Responses API get a
 * valid `image_url` block instead of the standard `source_type` data block, which @langchain/openai
 * mis-serialises to an invalid Responses image part), and prove that the file/audio path and
 * non-OpenAI providers are untouched. The registry wiring (that the factory threads the resolved
 * provider in) is checked at the end.
 *
 * CFG-69 adds the other half: the injection reaches the REQUEST and never the conversation. Every
 * block expectation here therefore reads the block the model handler was actually called with
 * ({@link runModelCall}), which is the same assertion as before against the value that now carries
 * it. The state half — that a rejected attachment cannot be replayed on a later turn — is pinned in
 * the CFG-69 block at the end, through a harness that drives whichever hooks the middleware
 * exposes so it measures the defect rather than the fix.
 */
import { describe, expect, it } from 'vitest';
import {
  AIMessage,
  convertToProviderContentBlock,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import type { GthConfig } from '#src/config.js';
import { DELIVERABLE_BINARY_FORMAT_TYPES } from '@gaunt-sloth/core/config/schema.js';
import {
  createBinaryContentInjectionMiddleware,
  isDeliverableFormatType,
  nonImageBinaryFateFor,
  type BinaryContentInjectionMiddlewareSettings,
} from '#src/middleware/binaryContentInjectionMiddleware.js';
import { imageBlockFor } from '#src/middleware/frontendImageInjectionMiddleware.js';
import { resolveMiddleware } from '#src/middleware/registry.js';
import {
  attachTerminationReason,
  classifyThrownTermination,
  terminationReason,
  terminationReasonOf,
} from '@gaunt-sloth/core/core/terminationReason.js';

/** A tiny valid 1×1 base64 PNG-ish payload — content is opaque to the middleware. */
const B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_MIME = 'image/png';
const PNG_DATA_URL = `data:${PNG_MIME};base64,${B64}`;
const IMG_PATH = '/tmp/some;weird path/photo.png';

/**
 * Build the `gth_read_binary` ToolMessage content string exactly as `parseBinaryContent` expects:
 * `gth_read_binary;type:<type>;path:<encodeURIComponent(path)>;data:<mime>;base64,<b64>`.
 */
function binaryToolContent(type: string, mime: string, data: string, filePath: string): string {
  return `gth_read_binary;type:${type};path:${encodeURIComponent(filePath)};data:${mime};base64,${data}`;
}

/** A native read-binary round: assistant tool-call request + its gth_read_binary ToolMessage result. */
function binaryRound(
  type: string,
  mime: string,
  data: string,
  filePath: string,
  id = 'call-1'
): BaseMessage[] {
  return [
    new AIMessage({ content: '', tool_calls: [{ name: 'gth_read_binary', args: {}, id }] }),
    new ToolMessage({
      content: binaryToolContent(type, mime, data, filePath),
      tool_call_id: id,
      name: 'gth_read_binary',
    }),
  ];
}

/** Read a hook off the middleware, whichever form `createMiddleware` returned it in. */
function hookOf(mw: any, name: string): any {
  const hook = mw?.[name];
  if (!hook) return undefined;
  return typeof hook === 'function' ? hook : hook.hook;
}

/**
 * Run one model call through the middleware and report what reached the model.
 *
 * `messages` is what the model handler was called with — the request as sent, which is where the
 * injected attachment lives now that it is request-scoped rather than written into state. `calls`
 * counts model calls: zero is what a refusal (CFG-63) must produce, and asserting it is stronger
 * than asserting the throw alone, since the throw now sits on the path that would otherwise reach
 * the provider.
 */
async function runModelCall(
  mw: any,
  messages: unknown[],
  respond: (sent: BaseMessage[]) => unknown = () => new AIMessage('ok')
): Promise<{ messages: BaseMessage[] | undefined; calls: number; response: unknown }> {
  const seen: BaseMessage[][] = [];
  const handler = async (request: any) => {
    seen.push(request.messages);
    return respond(request.messages);
  };
  const response = await hookOf(mw, 'wrapModelCall')({ messages, systemPrompt: '' }, handler);
  return { messages: seen[seen.length - 1], calls: seen.length, response };
}

/** The injected HumanMessage's content block at index 1 (index 0 is the text preamble). */
function injectedBlock(result: any): any {
  const msgs = result?.messages;
  if (!Array.isArray(msgs)) return undefined;
  const last = msgs[msgs.length - 1];
  return Array.isArray(last?.content) ? last.content[1] : undefined;
}

const cfg = () => ({}) as unknown as GthConfig;

async function mwFor(provider?: string) {
  const settings = { provider } as BinaryContentInjectionMiddlewareSettings;
  return createBinaryContentInjectionMiddleware(settings, cfg());
}

describe('binary-content-injection — per-provider IMAGE block (GS2-75)', () => {
  it('openai → image_url:{url} (valid on the Responses API, unlike the standard block)', async () => {
    const mw = await mwFor('openai');
    const result = await runModelCall(mw, binaryRound('image', PNG_MIME, B64, IMG_PATH));
    // Literal expected block — the real anti-regression anchor for the fix.
    expect(injectedBlock(result)).toEqual({
      type: 'image_url',
      image_url: { url: PNG_DATA_URL },
    });
  });

  it('ollama → image_url as a data-URL STRING', async () => {
    const mw = await mwFor('ollama');
    const result = await runModelCall(mw, binaryRound('image', PNG_MIME, B64, IMG_PATH));
    expect(injectedBlock(result)).toEqual({
      type: 'image_url',
      image_url: PNG_DATA_URL,
    });
  });

  // RC-32: a read binary image goes to Anthropic through the same converter as a captured camera
  // frame, and the standard block is double-emitted there (the second copy stamped `image/jpeg`,
  // which 400s a PNG outright). Both paths therefore share the provider-native block.
  it('anthropic → the provider-native base64 image block (RC-32)', async () => {
    const mw = await mwFor('anthropic');
    const result = await runModelCall(mw, binaryRound('image', PNG_MIME, B64, IMG_PATH));
    expect(injectedBlock(result)).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: PNG_MIME, data: B64 },
    });
  });

  it("default (provider '' / undefined) → the standard base64 image block", async () => {
    for (const mw of [await mwFor(''), await mwFor(undefined)]) {
      const result = await runModelCall(mw, binaryRound('image', PNG_MIME, B64, IMG_PATH));
      expect(injectedBlock(result)).toEqual({
        type: 'image',
        source_type: 'base64',
        mime_type: PNG_MIME,
        data: B64,
      });
    }
  });

  it('the injected image block tracks imageBlockFor (source of truth) across providers', async () => {
    for (const provider of ['openai', 'ollama', 'anthropic', 'google-genai', 'vertexai', '']) {
      const mw = await mwFor(provider);
      const result = await runModelCall(mw, binaryRound('image', PNG_MIME, B64, IMG_PATH));
      expect(injectedBlock(result)).toEqual(imageBlockFor(provider, PNG_MIME, B64));
    }
  });
});

describe('binary-content-injection — non-image binaries on providers that do not discard them', () => {
  // CONTROL for the CFG-63 block below: every provider here is measured `delivered-or-loud` or
  // unenumerated, so all of these pass both before and after the refusal was added. They are what
  // stops the refusal from growing: a change that started refusing more than the one measured
  // discarding provider reds here.
  it('a file (application/pdf) keeps the standard createContentBlock data-block, regardless of provider', async () => {
    for (const provider of ['openai', 'ollama', 'anthropic', '']) {
      const mw = await mwFor(provider);
      const result = await runModelCall(
        mw,
        binaryRound('file', 'application/pdf', B64, '/tmp/doc.pdf')
      );
      // NOT an image_url block; the standard block WITH filename metadata (createContentBlock path).
      expect(injectedBlock(result)).toEqual({
        type: 'file',
        source_type: 'base64',
        mime_type: 'application/pdf',
        data: B64,
        metadata: { filename: 'doc.pdf' },
      });
    }
  });

  // Two `gth_read_binary` calls in ONE step land as adjacent trailing ToolMessages, and both files
  // have to reach the model — a scan that stopped at the first match would drop one silently, with
  // the model then answering about a file it was never shown.
  //
  // The ORDER asserted here is the one the code produces (the scan walks back from the end, so the
  // last tool result is attached first) and is inherited rather than chosen. It is pinned as-is so
  // a future change to it is a decision somebody makes on purpose, not a side effect.
  it('two binary results in one step both reach the model', async () => {
    const mw = await mwFor('openai');
    const result = await runModelCall(mw, [
      new AIMessage({
        content: '',
        tool_calls: [
          { name: 'gth_read_binary', args: {}, id: 'call-a' },
          { name: 'gth_read_binary', args: {}, id: 'call-b' },
        ],
      }),
      new ToolMessage({
        content: binaryToolContent('file', 'application/pdf', B64, '/tmp/first.pdf'),
        tool_call_id: 'call-a',
        name: 'gth_read_binary',
      }),
      new ToolMessage({
        content: binaryToolContent('file', 'application/pdf', B64, '/tmp/second.pdf'),
        tool_call_id: 'call-b',
        name: 'gth_read_binary',
      }),
    ]);

    const filenames = (result.messages ?? [])
      .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
      .map((block: any) => block?.metadata?.filename)
      .filter(Boolean);
    expect(filenames).toEqual(['second.pdf', 'first.pdf']);
  });

  it('is a no-op when there is no gth_read_binary ToolMessage', async () => {
    const mw = await mwFor('openai');
    const history = [new HumanMessage('hi'), new AIMessage('hello')];
    const result = await runModelCall(mw, history);
    // A no-op is now "the model was called with exactly the messages it would have been called with
    // anyway" — the pass-through arm still has to make the call, so an absent return value would
    // mean a turn that never reached the model.
    expect(result.calls).toBe(1);
    expect(result.messages).toEqual(history);
  });
});

/**
 * CFG-63 — a provider whose converter silently discards a non-image block makes the model answer
 * blind, so gth refuses before the call instead of sending a request that only looks complete.
 *
 * The enumeration behind `nonImageBinaryFateFor` was measured by handing each installed client the
 * exact block this middleware emits, with `globalThis.fetch` replaced by a capture stub. Exactly one
 * provider label discards; the rest deliver the payload or fail where somebody sees it. That is why
 * this is a capability predicate rather than a per-provider block builder — for the one provider
 * that needs a different block, no such block exists.
 *
 * The vendor half of this — that `@langchain/xai` really does still discard — is pinned separately
 * in `packages/app/spec/xaiResponsesBinaryDiscard.vendor.spec.ts`, because only that package
 * declares `@langchain/xai`.
 */
describe('binary-content-injection — refuses a non-image binary a provider would discard (CFG-63)', () => {
  it('xai-responses + a PDF → an error naming the file and the provider, instead of an empty part', async () => {
    const mw = await mwFor('xai-responses');
    await expect(
      runModelCall(mw, binaryRound('file', 'application/pdf', B64, '/tmp/reports/q3-results.pdf'))
    ).rejects.toThrow(/q3-results\.pdf/);

    const mw2 = await mwFor('xai-responses');
    await expect(
      runModelCall(mw2, binaryRound('file', 'application/pdf', B64, '/tmp/reports/q3-results.pdf'))
    ).rejects.toThrow(/xai-responses/);
  });

  // The refusal sits on the path to the provider, so it can assert the thing the message only
  // describes: the request was never made. A refusal thrown AFTER the call would satisfy the cell
  // above and still hand the attachment to the converter that empties it.
  it('the refused attachment never reaches the model at all', async () => {
    const mw = await mwFor('xai-responses');
    let calls = 0;
    await expect(
      runModelCall(
        mw,
        binaryRound('file', 'application/pdf', B64, '/tmp/reports/q3-results.pdf'),
        () => {
          calls++;
          return new AIMessage('the model should never have been asked');
        }
      )
    ).rejects.toThrow(/q3-results\.pdf/);
    expect(calls).toBe(0);
  });

  // `audio` is what exercises this arm, and the second assertion is what keeps it exercised.
  // CFG-68's universal check runs FIRST and answers for `video` and `binary`, so a row for either
  // of those would pass here with the `xai-responses` case deleted from `nonImageBinaryFateFor` —
  // a cell that could no longer fail for its own reason. The video case is pinned in the CFG-68
  // block below instead, and this one asserts the sentence only the per-provider measurement
  // produces.
  it('audio is refused on the same provider for the same reason', async () => {
    const mw = await mwFor('xai-responses');
    await expect(
      runModelCall(mw, binaryRound('audio', 'audio/mpeg', B64, '/tmp/briefing.mp3'))
    ).rejects.toThrow(/briefing\.mp3/);

    const mw2 = await mwFor('xai-responses');
    await expect(
      runModelCall(mw2, binaryRound('audio', 'audio/mpeg', B64, '/tmp/briefing.mp3'))
    ).rejects.toThrow(/replaces every non-image attachment with an empty text part/);
  });

  // The other half of the fix: an IMAGE on the same provider must still work exactly as CFG-45 left
  // it. This is the control that must SURVIVE — if the refusal were keyed on the provider alone
  // rather than on the provider AND a non-image format, this cell reds.
  it('CONTROL — an image on xai-responses is still injected, exactly as CFG-45 left it', async () => {
    const mw = await mwFor('xai-responses');
    const result = await runModelCall(mw, binaryRound('image', PNG_MIME, B64, IMG_PATH));
    expect(injectedBlock(result)).toEqual({ type: 'image_url', image_url: { url: PNG_DATA_URL } });
    expect(injectedBlock(result)).toEqual(imageBlockFor('xai-responses', PNG_MIME, B64));
  });

  it('the fate table matches the measurement: one label discards, the enumerated rest do not', () => {
    expect(nonImageBinaryFateFor('xai-responses')).toBe('silently-discarded');
    for (const provider of [
      'anthropic',
      'openai',
      'openrouter',
      'deepseek',
      'xai',
      'huggingface',
      'groq',
      'ollama',
      'google-genai',
      'vertexai',
      'google',
    ]) {
      expect(nonImageBinaryFateFor(provider)).toBe('delivered-or-loud');
    }
  });

  // CFG-45's ruling that this path stays permissive for an unmeasured label is unchanged. Who
  // actually lands here: any label `nonImageBinaryFateFor` does not enumerate — a custom or `fake`
  // provider, a future vendor package, a LangChain class whose `_llmType()` nobody has measured —
  // plus the empty string, which `resolveVisionProvider` yields only when there is no `llm` or its
  // `_llmType()` is missing or throws. A module config supplying an already-built LLM does NOT
  // generally give `''`; it gives that class's own label, which is exactly how `xai-responses`
  // reaches the switch at all. Refusing on a label nobody has measured would break configurations
  // that work today.
  it('CONTROL — an unenumerated label is unmeasured, and its attachment is still sent', async () => {
    for (const provider of ['', 'fake', 'some-future-provider']) {
      expect(nonImageBinaryFateFor(provider)).toBe('unmeasured');
      const mw = await mwFor(provider);
      const result = await runModelCall(
        mw,
        binaryRound('file', 'application/pdf', B64, '/tmp/doc.pdf')
      );
      expect(injectedBlock(result)).toEqual({
        type: 'file',
        source_type: 'base64',
        mime_type: 'application/pdf',
        data: B64,
        metadata: { filename: 'doc.pdf' },
      });
    }
  });
});

/**
 * CFG-68 — `video` and `binary` are format types NO provider can receive.
 *
 * **The handler here is LangChain's own dispatcher, and that is the point of the block.** Every
 * vendor converter reaches a request body through `convertToProviderContentBlock`, so running the
 * injected block through it reproduces what the provider boundary does, with no network and no
 * vendor client. It is what makes the filename assertions DISCRIMINATING rather than merely
 * agreeable: delete the refusal and these cells do not fail on a technicality, they fail carrying
 * `Unable to convert content block type 'video' to provider-specific format: not recognized.` —
 * the message CFG-68 exists to replace, naming a block type the user never typed and no file at
 * all.
 */
describe('binary-content-injection — a format type no provider can receive (CFG-68)', () => {
  /**
   * Convert every block of the injected message exactly as a provider client does. The converter
   * implements all four `fromStandard*Block` methods and returns the block untouched, so the only
   * thing that can throw is the dispatcher failing to recognise the block type — never a gap in
   * this stub.
   */
  function convertLikeAProvider(sent: BaseMessage[]): AIMessage {
    const last = sent[sent.length - 1];
    const blocks = Array.isArray(last?.content) ? last.content : [];
    for (const block of blocks) {
      convertToProviderContentBlock(
        block as never,
        {
          providerName: 'spec-provider',
          fromStandardTextBlock: (b: unknown) => b,
          fromStandardImageBlock: (b: unknown) => b,
          fromStandardAudioBlock: (b: unknown) => b,
          fromStandardFileBlock: (b: unknown) => b,
        } as never
      );
    }
    return new AIMessage('ok');
  }

  it.each([
    ['video', 'video/mp4', '/tmp/clips/site-survey.mp4', 'site-survey.mp4'],
    ['binary', 'application/octet-stream', '/tmp/dumps/firmware.bin', 'firmware.bin'],
  ])(
    '%s → an error naming the attached file and the configured format type',
    async (type, mime, filePath, filename) => {
      const mw = await mwFor('openai');
      const call = () =>
        runModelCall(mw, binaryRound(type, mime, B64, filePath), convertLikeAProvider);

      // The file the user attached, which LangChain's own message never mentions.
      await expect(call()).rejects.toThrow(new RegExp(filename.replace('.', '\\.')));
      // The format type as CONFIGURED, quoted.
      await expect(call()).rejects.toThrow(new RegExp(`"${type}"`));
      // And NOT the normalised label. `getFormatLabel` maps an unrecognised type to `file`, so a
      // message built from it would quote a type the user did not configure — and one that would
      // have worked. `file` appears in the message only as part of the unquoted vocabulary list,
      // so a QUOTED "file" can arrive by no other route than that substitution. Measured: the
      // assertion above alone does not catch it, because the message names the configured type
      // twice and the substitution only reaches the first.
      await expect(call()).rejects.not.toThrow(/"file"/);
      // And not LangChain's vocabulary: `content block type` is the phrase the user should never
      // meet here, whichever block type it is applied to.
      await expect(call()).rejects.not.toThrow(/content block type/);
    }
  );

  // The refusal sits ahead of the model call, so it can assert the thing the message only
  // describes. A refusal thrown after the call would satisfy the cells above and still have built
  // a request that costs a round trip to reject.
  it('the refused attachment never reaches the model at all', async () => {
    const mw = await mwFor('openai');
    let calls = 0;
    await expect(
      runModelCall(mw, binaryRound('video', 'video/mp4', B64, '/tmp/clips/site-survey.mp4'), () => {
        calls++;
        return new AIMessage('the model should never have been asked');
      })
    ).rejects.toThrow(/site-survey\.mp4/);
    expect(calls).toBe(0);
  });

  // CFG-68 refuses before the per-provider measurement, because "use a provider that accepts video
  // attachments" is advice no provider can satisfy. This pins the ORDER: on the one label measured
  // to discard silently, a video attachment gets the universal message, not that advice.
  it('on xai-responses a video gets the universal refusal, not the change-provider advice', async () => {
    const mw = await mwFor('xai-responses');
    await expect(
      runModelCall(mw, binaryRound('video', 'video/mp4', B64, '/tmp/clips/site-survey.mp4'))
    ).rejects.toThrow(/no model provider can receive/);
  });

  /**
   * CONTROL — this must SURVIVE every mutation the cells above are controlled with. The three
   * deliverable types still convert through the same dispatcher that rejects the other two, which
   * is what stops the refusal growing into "no attachment works": a check keyed on anything
   * broader than the measured set reds here.
   */
  it('CONTROL — image, file and audio are still injected and still convert', async () => {
    for (const [type, mime, filePath] of [
      ['image', PNG_MIME, '/tmp/photo.png'],
      ['file', 'application/pdf', '/tmp/doc.pdf'],
      ['audio', 'audio/mpeg', '/tmp/briefing.mp3'],
    ] as const) {
      const mw = await mwFor('');
      const result = await runModelCall(
        mw,
        binaryRound(type, mime, B64, filePath),
        convertLikeAProvider
      );
      expect(result.calls).toBe(1);
      expect(injectedBlock(result)).toMatchObject({ type, source_type: 'base64', mime_type: mime });
    }
  });

  it('the refused vocabulary is exactly the two types the config schema also refuses', () => {
    for (const type of DELIVERABLE_BINARY_FORMAT_TYPES) {
      expect(isDeliverableFormatType(type)).toBe(true);
    }
    for (const type of ['video', 'binary', 'text', '']) {
      expect(isDeliverableFormatType(type)).toBe(false);
    }
  });
});

describe('binary-content-injection — registry wiring', () => {
  it('the factory threads the resolved provider through (openai → image_url:{url})', async () => {
    const [mw] = await resolveMiddleware(['binary-content-injection'], {
      llm: {},
      modelProviderType: 'openai',
    } as unknown as GthConfig);
    expect(mw.name).toBe('binary-content-injection');
    const result = await runModelCall(mw, binaryRound('image', PNG_MIME, B64, IMG_PATH));
    expect(injectedBlock(result)).toEqual({ type: 'image_url', image_url: { url: PNG_DATA_URL } });
  });

  it('a non-openai resolved provider (ollama) yields the ollama string image_url', async () => {
    const [mw] = await resolveMiddleware(['binary-content-injection'], {
      llm: {},
      modelProviderType: 'ollama',
    } as unknown as GthConfig);
    const result = await runModelCall(mw, binaryRound('image', PNG_MIME, B64, IMG_PATH));
    expect(injectedBlock(result)).toEqual({ type: 'image_url', image_url: PNG_DATA_URL });
  });

  it('the DEFAULT-ON auto-inject path (binaryFormats, no explicit name) also threads the provider — the exact path that broke it openai', async () => {
    // Production fires this middleware via binaryFormats auto-inject, not by explicit name; this is
    // the openai Responses regression scenario end to end at the resolver level.
    const mws = await resolveMiddleware(undefined, {
      llm: {},
      modelProviderType: 'openai',
      binaryFormats: [{ type: 'image', extensions: ['png'] }],
    } as unknown as GthConfig);
    const mw = mws.find((m) => m.name === 'binary-content-injection');
    expect(mw).toBeDefined();
    const result = await runModelCall(mw, binaryRound('image', PNG_MIME, B64, IMG_PATH));
    expect(injectedBlock(result)).toEqual({ type: 'image_url', image_url: { url: PNG_DATA_URL } });
  });
});

/**
 * CFG-69 — one rejected attachment must not kill the session.
 *
 * The measured shape: a provider that rejects the injected block fails the turn, and then fails
 * every later turn too — on the same message index, carrying no attachment and mentioning no file —
 * because the injected message was written into the conversation and is re-sent forever. Two things
 * put it there, and BOTH are pinned below, because either one alone leaves the session dead: the
 * injection being a state update, and the scan matching a tool result the current call is no longer
 * the continuation of.
 *
 * The instrument is a stubbed rejecting handler, never a vendor call. What Groq does is already
 * measured and recorded in `nonImageBinaryFateFor`; what is under test here is what gth does about
 * it, which a stub reproduces exactly.
 */

/** The rejection Groq returns for a `file` part, in its own words. */
function providerRejection(): Error {
  const error: Error & { status?: number } = new Error(
    '400 status code (no body) {"error":{"message":"messages.4.content.1 : ' +
      "for 'messages.4.content.1' expected one of 'text', 'image_url', 'document'\"," +
      '"type":"invalid_request_error","code":"invalid_value"}}'
  );
  error.status = 400;
  return error;
}

/** The structured (non-text) content blocks in a message list — an attachment, wherever it rides. */
function binaryBlocksIn(messages: readonly BaseMessage[] | undefined): unknown[] {
  return (messages ?? []).flatMap((message) =>
    Array.isArray(message.content)
      ? (message.content as { type?: string }[]).filter((block) => block?.type !== 'text')
      : []
  );
}

/**
 * A miniature of how the graph carries messages between turns, driving whatever hooks the
 * middleware exposes.
 *
 * That last part is what makes the cells below regression pins rather than tests of the new code:
 * the harness runs `beforeModel` if there is one and `wrapModelCall` if there is one, so restoring
 * either half of the defect is measured here instead of silently skipped.
 *
 * A `beforeModel` update REPLACES `state.messages`, because the full array is what that hook
 * returns. It is applied before the model call and kept when the call throws — a completed graph
 * node's update is committed whether or not the next node succeeds, which is exactly why the live
 * failure kept naming the same index across three turns.
 */
function makeSession(mw: any) {
  const session = {
    messages: [] as BaseMessage[],
    /** What the model handler was called with, one entry per model call. */
    sent: [] as BaseMessage[][],
    async turn(respond: (sent: BaseMessage[]) => unknown): Promise<unknown> {
      const beforeModel = hookOf(mw, 'beforeModel');
      if (beforeModel) {
        const update = await beforeModel({ messages: session.messages });
        if (update?.messages) session.messages = update.messages;
      }
      const handler = async (request: any) => {
        session.sent.push(request.messages);
        return respond(request.messages);
      };
      const request = { messages: session.messages, systemPrompt: '' };
      const wrapModelCall = hookOf(mw, 'wrapModelCall');
      const answer = wrapModelCall ? await wrapModelCall(request, handler) : await handler(request);
      if (answer) session.messages = [...session.messages, answer as BaseMessage];
      return answer;
    },
  };
  return session;
}

describe('binary-content-injection — a rejected attachment cannot outlive its request (CFG-69)', () => {
  it('THE PIN — after a provider rejects the attachment, the next unrelated message reaches the model', async () => {
    const mw = await mwFor('groq');
    const session = makeSession(mw);
    session.messages = [
      new HumanMessage('Use read binary tool to read test.pdf'),
      ...binaryRound('file', 'application/pdf', B64, '/tmp/test.pdf'),
    ];

    // Turn 1: the provider rejects the block. This turn is expected to fail — it is the turn AFTER
    // it that the user's session hangs on.
    await expect(
      session.turn(() => {
        throw providerRejection();
      })
    ).rejects.toThrow();

    // Turn 2: an ordinary message. No attachment, no file mentioned.
    session.messages = [...session.messages, new HumanMessage('Did it work?')];
    const answer = await session.turn(() => new AIMessage('it did not, the file was rejected'));

    expect(session.sent).toHaveLength(2);
    expect(binaryBlocksIn(session.sent[1])).toEqual([]);
    expect((answer as AIMessage).content).toBe('it did not, the file was rejected');
  });

  it('the injected message is not in state on the turn after the one it was built for', async () => {
    const mw = await mwFor('groq');
    const session = makeSession(mw);
    session.messages = [...binaryRound('file', 'application/pdf', B64, '/tmp/test.pdf')];

    await session.turn(() => new AIMessage('a one page invoice'));

    // The model saw the attachment on the call it was built for...
    expect(binaryBlocksIn(session.sent[0])).toHaveLength(1);
    // ...and the conversation carries no trace of it. The gth_read_binary ToolMessage stays, so the
    // fact that the file was read is not lost — only the payload is.
    expect(binaryBlocksIn(session.messages)).toEqual([]);
    expect(session.messages.some((m) => (m as any).name === 'gth_read_binary')).toBe(true);
  });

  it('a call the tool result no longer trails does not re-attach it', async () => {
    // The second half of the defect, on its own: with the tool result a couple of messages back,
    // a scan of the last few messages still matches it and rebuilds the attachment onto a request
    // that has nothing to do with it.
    const mw = await mwFor('groq');
    const result = await runModelCall(mw, [
      ...binaryRound('file', 'application/pdf', B64, '/tmp/test.pdf'),
      new HumanMessage('Did it work?'),
    ]);
    expect(result.calls).toBe(1);
    expect(binaryBlocksIn(result.messages)).toEqual([]);
  });

  it('the error a user reads names the file and the provider and says the conversation is unaffected', async () => {
    const mw = await mwFor('groq');
    const error: any = await runModelCall(
      mw,
      binaryRound('file', 'application/pdf', B64, HOSTILE_NAMES[0]),
      () => {
        throw providerRejection();
      }
    ).catch((thrown) => thrown);

    expect(error.message).toMatch(/"api-timeout-investigation\.pdf" \(application\/pdf\)/);
    expect(error.message).toMatch(/"groq"/);
    expect(error.message).toMatch(/NOT part of the conversation/);
    // The vendor's own words are kept, not replaced: they are what a bug report needs.
    expect(error.message).toContain('invalid_request_error');
  });

  /**
   * The filenames a user can hand this middleware, chosen because each one contains a token the
   * exception classifier matches BEFORE it reaches the invalid-request arm.
   *
   * They are the input the pin must use. A benign name like `test.pdf` cannot exercise the hazard
   * at all, so a cell built on one asserts something that could not have failed — while the half of
   * the note that carries real risk is exactly the half the user controls.
   */
  const HOSTILE_NAMES = [
    '/tmp/api-timeout-investigation.pdf', // 'timeout'  → would classify timeout
    '/tmp/contract - terminated.pdf', //     'terminated' → would classify network_error
    '/tmp/forbidden-zones-map.pdf', //       'forbidden'  → would classify auth_failed
    '/tmp/rate limit escalation.pdf', //     'rate limit' → would classify rate_limited
    '/tmp/internal error postmortem.pdf', // 'internal error' → would classify provider_error
  ];

  /**
   * How every consumer of a thrown termination reads it: the attached value first, the text only
   * when nothing has been committed. Copied from `GthAgentRunner.handleContextOverflow`, and
   * `classifyThrownAt` has the same shape — those two are the only readers in the tree.
   *
   * The cell below asserts through this because it is the shape a consumer actually has. Since
   * CFG-73 the bare feeder gives the same answer — it prefers the committed reason too — and the
   * cell after it pins exactly that, so the two readings are held together rather than assumed
   * equal.
   */
  function categoryAsAConsumerReadsIt(error: unknown): string {
    return terminationReasonOf(error)?.category ?? classifyThrownTermination(error).category;
  }

  it('a filename cannot change what the failure IS — every hostile name still reads invalid_request', async () => {
    // The classification is committed as a value before the note is written, so what the file is
    // called cannot reach the decision. Without that, each of these names re-classifies the failure
    // into something the user is told to RETRY — the exact opposite of what this node is for, and
    // for an overflow-matching name it would send the runner off to compact and retry.
    expect(categoryAsAConsumerReadsIt(providerRejection())).toBe('invalid_request');

    for (const filePath of HOSTILE_NAMES) {
      const mw = await mwFor('groq');
      const error = await runModelCall(
        mw,
        binaryRound('file', 'application/pdf', B64, filePath),
        () => {
          throw providerRejection();
        }
      ).catch((thrown) => thrown);

      // The note really is present, and really does carry the hostile name — otherwise this cell
      // would pass on a middleware that protected the classification by saying nothing.
      expect((error as Error).message).toMatch(/NOT part of the conversation/);
      expect((error as Error).message).toContain(filePath.split('/').pop());
      expect(categoryAsAConsumerReadsIt(error)).toBe('invalid_request');
      expect(terminationReasonOf(error)?.retryableAsIs).toBe(false);
    }
  });

  /**
   * CFG-73 — the same question asked of the BARE feeder, which is where CFG-69 left a residual.
   *
   * Under CFG-69 the middleware protected its two consumers by committing the value first, and
   * `classifyThrownTermination` called directly on the annotated error still read the filename and
   * answered `timeout`. CFG-73 closed that at the source: the feeder now prefers a committed reason
   * over prose, so the bare call and the consumer call agree. This cell is the end-to-end form of
   * that rule — the core pin in `terminationTaxonomy.spec.ts` asserts it on constructed errors,
   * while this one drives the real middleware and the real note, so the two halves cannot drift.
   *
   * It is deliberately the same input the residual used, so a regression restores the residual's
   * own answer here rather than passing quietly.
   */
  it('CFG-73 — the bare text feeder agrees with the consumers now, on every hostile name', async () => {
    for (const filePath of HOSTILE_NAMES) {
      const mw = await mwFor('groq');
      const error = await runModelCall(
        mw,
        binaryRound('file', 'application/pdf', B64, filePath),
        () => {
          throw providerRejection();
        }
      ).catch((thrown) => thrown);

      // The note is present and carries the hostile name, so the text a matcher would read really
      // does contain the token — this cell cannot pass by the note having been made bland.
      expect((error as Error).message).toContain(filePath.split('/').pop());
      expect(classifyThrownTermination(error).category).toBe('invalid_request');
      expect(categoryAsAConsumerReadsIt(error)).toBe('invalid_request');
    }
  });

  it('the reason it attaches names this site and does not overwrite an inner one', async () => {
    const mw = await mwFor('groq');
    const error = await runModelCall(
      mw,
      binaryRound('file', 'application/pdf', B64, HOSTILE_NAMES[0]),
      () => {
        throw providerRejection();
      }
    ).catch((thrown) => thrown);
    expect(terminationReasonOf(error)?.site).toBe('middleware.binary-attachment-rejected');
    expect(terminationReasonOf(error)?.provider).toBe('groq');
    // The posture is what a surface prints beside the note; a retry hint here would contradict it.
    expect(terminationReasonOf(error)?.retryableAsIs).toBe(false);

    // First-write-wins: a site that classified this failure before us keeps it.
    const preClassified = providerRejection();
    attachTerminationReason(
      preClassified,
      terminationReason('runner.turn-error', 'exception', { category: 'invalid_request' })
    );
    const mw2 = await mwFor('groq');
    const error2 = await runModelCall(
      mw2,
      binaryRound('file', 'application/pdf', B64, HOSTILE_NAMES[0]),
      () => {
        throw preClassified;
      }
    ).catch((thrown) => thrown);
    expect(terminationReasonOf(error2)?.site).toBe('runner.turn-error');
  });

  it('CONTROL — a failure that is not a rejection of the request is passed on untouched', async () => {
    const mw = await mwFor('groq');
    const raw = new Error('fetch failed');
    const error = await runModelCall(
      mw,
      binaryRound('file', 'application/pdf', B64, '/tmp/test.pdf'),
      () => {
        throw raw;
      }
    ).catch((thrown) => thrown);

    // A dropped connection on a turn that happened to carry an attachment is not about the
    // attachment, and a note saying otherwise sends the user after the wrong thing.
    expect(error).toBe(raw);
    expect(error.message).toBe('fetch failed');
  });
});
