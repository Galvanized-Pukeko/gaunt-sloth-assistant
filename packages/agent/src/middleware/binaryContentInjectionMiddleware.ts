/**
 * @packageDocumentation
 * Middleware to inject binary content (images, PDFs, audio) as HumanMessage.
 *
 * The gth_read_binary tool returns binary data as a special string format:
 * gth_read_binary;type:${type};path:${encodedPath};data:${media_type};base64,${data}
 * where path is URL-encoded to handle special characters like semicolons.
 *
 * This middleware:
 * 1. Detects the gth_read_binary tool calls
 * 2. Parses the special string format from ToolMessage content
 * 3. Adds a HumanMessage carrying the binary content block to the model call that follows the tool
 *    result — to that REQUEST only, never to the conversation (see {@link wrapModelCall} below)
 * 4. Refuses a non-image attachment bound for a provider measured to discard it silently
 *    (see {@link nonImageBinaryFateFor})
 * 5. Says, in the user's terms, that an attachment rode a request the provider rejected, and that
 *    the conversation is unaffected (see `noteRejectedAttachment`)
 *
 * This works around LangChain's limitation where ToolMessage doesn't properly
 * support binary content blocks for most providers.
 */

import { createMiddleware, type AgentMiddleware } from 'langchain';
import path from 'node:path';
import type { GthConfig } from '@gaunt-sloth/core/config.js';
import { debugLog } from '@gaunt-sloth/core/utils/debugUtils.js';
import { classifyThrownTermination } from '@gaunt-sloth/core/core/terminationReason.js';
import { HumanMessage, isToolMessage } from '@langchain/core/messages';
import type { BaseMessage, MessageContent } from '@langchain/core/messages';
import { imageBlockFor } from '#src/middleware/frontendImageInjectionMiddleware.js';

export interface BinaryContentInjectionMiddlewareSettings {
  name?: 'binary-content-injection';
  /**
   * The gth provider string. It selects the per-provider image-block shape (see
   * {@link imageBlockFor}) and, for every other format, decides whether the attachment may be sent
   * at all (see {@link nonImageBinaryFateFor}). Derived by the registry factory via
   * `resolveVisionProvider(gthConfig)`; may be `''`/absent, in which case the standard base64 block
   * is emitted and nothing is refused.
   */
  provider?: string;
}

/**
 * What a provider's message converter does with a NON-IMAGE standard data block
 * (`{ type:'file'|'audio'|'video'|'binary', source_type:'base64', mime_type, data }`) — the block
 * `createContentBlock` builds. (Named, not `{@link}`ed: it is module-private, and a link to an
 * unexported symbol renders as dead text in the API reference.)
 *
 * - `silently-discarded` — the converter replaces the block with an empty part and builds a request
 *   as if nothing were attached. Nothing throws, nothing warns, and the model answers about content
 *   it never received. This is the only value that must be refused.
 * - `delivered-or-loud` — the client either puts the data in the request body or fails where
 *   somebody sees it: a client-side throw, or a provider rejection the user reads. For most labels
 *   what CFG-63 measured is the CLIENT half and gth stays out of the way. `groq` is the one whose
 *   client settles nothing — it forwards the block untouched — so its SERVER half was measured
 *   separately, and it rejects. See the `groq` arm below.
 * - `unmeasured` — the label is not enumerated below. Treated exactly as before this check existed.
 */
export type NonImageBinaryFate = 'silently-discarded' | 'delivered-or-loud' | 'unmeasured';

/**
 * The measured fate of a non-image binary block, per provider label.
 *
 * **Measured CFG-63, not inferred.** Every arm below comes from handing the installed client the
 * exact block `createContentBlock` emits, with `globalThis.fetch` replaced by a capture stub
 * (no network, no vendor calls), and reading either the thrown error or the request body that was
 * built. The value is the same for `file`, `audio`, `video` and `binary`, because what separates the
 * arms is whether the converter has a branch for the block at all — not which format it carries.
 *
 * - `xai-responses` → **silently-discarded**. `@langchain/xai@1.4.10`
 *   `dist/converters/responses.js:30-33` — the human-message branch recognises `text` and
 *   `image_url` and returns `{ type:'input_text', text:'' }` for everything else. The probe against
 *   `https://api.x.ai/v1/responses` built a body carrying no trace of the base64 payload for all
 *   four format types. There is no shape that would work instead: xAI's Responses union offers only
 *   `input_file` carrying a Files-API `file_id`, and gth has no upload path to produce one.
 * - `anthropic` → delivered-or-loud. `@langchain/anthropic@1.5.8` `dist/utils/content.js:78`
 *   (`fromStandardFileBlock`) converts a PDF to a `document` block; a non-PDF non-image mime throws
 *   `Unsupported file mime type for file base64 source`, audio throws
 *   `Converter for anthropic does not implement fromStandardAudioBlock method`, and video/binary
 *   throw from `@langchain/core`'s dispatcher.
 * - `openai`, `openrouter`, `deepseek`, `xai`, `huggingface` → delivered-or-loud. All reach
 *   `@langchain/openai@1.5.10` `dist/converters/completions.js:72` (`fromStandardFileBlock` → a
 *   `file` part carrying `file_data`) and `:34` (`fromStandardAudioBlock` → `input_audio` for
 *   wav/mp3, a throw otherwise). `openai` on the Responses path (GS2-74) converts a file at
 *   `dist/converters/responses.js:1081-1097` into `input_file` instead; both wire paths deliver it.
 * - `google-genai`, `vertexai`, `google` → delivered-or-loud. `@langchain/google@0.2.3`
 *   `dist/converters/messages.js:80` and `:49` turn file and audio into `inlineData`; video and
 *   binary throw from the dispatcher.
 * - `ollama` → delivered-or-loud. `@langchain/ollama@1.3.0` `dist/utils.js:92` throws
 *   `Unsupported content type: <type>` for every non-`text`/`image_url` part.
 * - `groq` → delivered-or-loud, and this is the one arm measured on the SERVER rather than the
 *   client. `@langchain/groq@1.3.1` `dist/chat_models.js:82` assigns `content: message.content`
 *   verbatim, so the block reaches the wire unchanged and only Groq's API can decide. Measured live
 *   2026-09-08 against `qwen/qwen3.8-27b` with a PDF: the API **rejects** it — HTTP 400
 *   `invalid_request_error`, naming the content-part types it accepts, `text` / `image_url` /
 *   `document`. The user reads that error, so nothing is discarded and nothing is refused here.
 *   **Note what the rejection also reveals:** Groq has a `document` part type, and gth emits the
 *   standard block's `file`, which is not one of the three — so a shape Groq would accept plausibly
 *   exists and gth does not build it. Whether any Groq model then *reads* a `document` is a separate
 *   question and is NOT established; do not treat the accepted type as a working feature.
 *
 * Everything else is `unmeasured`, and like {@link imageBlockFor}'s fallback arm it must stay
 * permissive. Who lands there, precisely: any label this switch does not enumerate — a custom or
 * `fake` provider, a future vendor package, a LangChain class whose `_llmType()` nobody has measured
 * — plus the empty string, which `resolveVisionProvider` yields only when there is no `llm` or its
 * `_llmType()` is missing or throws. (A module config supplying an already-built LLM does NOT
 * generally give `''`: `modelProviderType` is unset there, so the `_llmType()` fallback runs and
 * returns that class's own label — which is exactly how `xai-responses` arrives above.) Refusing on
 * a label nobody has measured would break configurations that work today, so this leaves a
 * `debugLog` trace instead and an unenumerated label is discoverable in a `/debug-dump`.
 *
 * Exported so each arm can be unit-tested directly.
 */
export function nonImageBinaryFateFor(provider: string): NonImageBinaryFate {
  switch (provider) {
    case 'xai-responses':
      return 'silently-discarded';
    case 'anthropic':
    case 'openai':
    case 'openrouter':
    case 'deepseek':
    case 'xai':
    case 'huggingface':
    case 'groq':
    case 'ollama':
    case 'google-genai':
    case 'vertexai':
    case 'google':
      return 'delivered-or-loud';
    default:
      if (provider) {
        debugLog(
          `nonImageBinaryFateFor: provider "${provider}" is not enumerated; the attachment is sent ` +
            `as the standard base64 block. If its converter discards unrecognised parts, add a ` +
            `MEASURED case for it (CFG-63) rather than one by analogy.`
        );
      }
      return 'unmeasured';
  }
}

interface ParsedBinaryContent {
  formatType: string;
  path: string;
  media_type: string;
  data: string;
}

/**
 * Parse the special binary format string returned by gth_read_binary tool.
 * Format: gth_read_binary;type:${type};path:${encodedPath};data:${media_type};base64,${data}
 * Path is URL-encoded to handle special characters.
 */
function parseBinaryContent(content: string): ParsedBinaryContent | null {
  if (!content.startsWith('gth_read_binary;')) {
    return null;
  }

  try {
    const parts = content.split(';');
    if (parts.length < 4) {
      return null;
    }

    const typeMatch = parts[1]?.match(/^type:(.+)$/);
    const pathMatch = parts[2]?.match(/^path:(.+)$/);
    const dataMatch = parts[3]?.match(/^data:(.+)$/);
    const base64Match = content.match(/;base64,(.+)$/);

    if (!typeMatch || !pathMatch || !dataMatch || !base64Match) {
      return null;
    }

    // Decode the URL-encoded path
    const decodedPath = decodeURIComponent(pathMatch[1]);

    return {
      formatType: typeMatch[1],
      path: decodedPath,
      media_type: dataMatch[1],
      data: base64Match[1],
    };
  } catch {
    return null;
  }
}

function createContentBlock(binaryData: ParsedBinaryContent): Record<string, unknown> {
  const { formatType, media_type, data } = binaryData;

  return {
    type: formatType,
    source_type: 'base64',
    mime_type: media_type,
    data,
    metadata: {
      filename: path.basename(binaryData.path),
    },
  };
}

function getFormatLabel(formatType: string): string {
  const labels: Record<string, string> = {
    image: 'image',
    video: 'video',
    audio: 'audio',
    file: 'file',
  };
  return labels[formatType] || 'file';
}

/**
 * The `gth_read_binary` results this model call is the direct continuation of: the trailing run of
 * ToolMessages, which is exactly what a model call following tool execution ends with.
 *
 * **The window is the fix, not a tidy-up.** Scanning a fixed number of recent messages instead
 * re-matches the same tool result on the NEXT turn, when the user has typed something unrelated and
 * the ToolMessage has not yet aged out — so the attachment is rebuilt and re-sent on a request that
 * has nothing to do with it. A provider that rejects the block then rejects every one of those
 * turns too, which is the whole session-killing shape [[CFG-69]] exists to remove; scoping the
 * injection by state alone would leave that half standing. Stopping at the first non-tool message
 * also keeps the multi-attachment case intact: parallel `gth_read_binary` calls in one step land as
 * adjacent ToolMessages and are all collected.
 *
 * `isToolMessage` rather than `instanceof ToolMessage`: the predicate is class-identity free, so a
 * second `@langchain/core` copy in a consumer's tree cannot make a real tool result look like the
 * end of the run and silently drop the attachment.
 */
function collectTrailingBinaryContent(messages: readonly BaseMessage[]): ParsedBinaryContent[] {
  const found: ParsedBinaryContent[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!isToolMessage(msg)) break;
    if (msg.name === 'gth_read_binary' && typeof msg.content === 'string') {
      const parsedContent = parseBinaryContent(msg.content);
      if (parsedContent) {
        found.push(parsedContent);
      }
    }
  }
  return found;
}

/**
 * Say what happened to the person watching, when a request carrying an attachment is rejected.
 *
 * What they get otherwise is the vendor's validation dump — an index into a message array
 * (`messages.4.content.1`) that names neither the file nor the provider, and says nothing about
 * whether the conversation is still usable. That last part is the question they actually have, and
 * since the injection is request-scoped the answer is a definite yes.
 *
 * **Only a rejection of the request itself is annotated**, decided by the shared classifier rather
 * than by a second opinion about error prose: a dropped connection or a rate limit on a turn that
 * happened to carry an attachment is not about the attachment, and a note claiming otherwise would
 * send the user chasing the wrong thing. The claims made are true even when the attachment was not
 * what the provider objected to — the request did carry it, and it is not in the conversation.
 *
 * The original error is annotated and rethrown rather than replaced, so the status, name, cause and
 * any classification already attached survive: {@link classifyThrownTermination} reads the text, so
 * a wrapper would decide the category from prose alone. **The added sentence therefore has to avoid
 * every token that classifies EARLIER than the invalid-request arm** — rate/quota, auth, timeout,
 * network and provider-fault wording — or the note itself would restate the failure as a different
 * kind and cost the user the one fact this category carries: that sending it again will not help.
 * `binaryContentInjectionMiddleware.spec.ts` pins that with the classifier itself.
 *
 * Fail-soft in both directions: a non-Error throw and an unwritable `message` leave the failure
 * exactly as it arrived, because explaining one must never become a second one.
 */
function noteRejectedAttachment(error: unknown, attachments: string[], provider: string): unknown {
  try {
    if (attachments.length === 0 || !(error instanceof Error)) return error;
    if (classifyThrownTermination(error).category !== 'invalid_request') return error;
    const providerLabel = provider ? `"${provider}"` : 'the model provider';
    const noun = attachments.length === 1 ? 'attachment' : 'attachments';
    error.message =
      `The provider ${providerLabel} would not accept this request. It carried the ${noun} ` +
      `${attachments.join(', ')}, which gth_read_binary read and added to that one request only — ` +
      `so the ${noun} is NOT part of the conversation and your next message is unaffected. Ask ` +
      `again without reading that file, or use a provider that accepts it. ` +
      `What the provider said follows.\n` +
      error.message;
  } catch {
    /* explaining a failure must never become a second failure */
  }
  return error;
}

export function createBinaryContentInjectionMiddleware(
  settings: BinaryContentInjectionMiddlewareSettings,
  _gthConfig: GthConfig
): Promise<AgentMiddleware> {
  debugLog('Creating binary content injection middleware');

  // The provider selecting the image-block shape; '' falls to the standard base64 block.
  const provider = settings.provider ?? '';

  return Promise.resolve(
    createMiddleware({
      name: 'binary-content-injection',

      // Add the binary content to the model call that follows the tool result — to the REQUEST,
      // never to graph state.
      //
      // [[CFG-69]] — **the injection must never be a state update, and that is what this hook
      // choice buys.** A `beforeModel` returning `{ messages }` writes the injected HumanMessage
      // into the conversation, where it is re-sent on every later request. Measured live on `groq`,
      // whose API rejects a non-image attachment with a 400 (see {@link nonImageBinaryFateFor}'s
      // `groq` arm): the first turn failed on `messages.4`, and so did the next two, which carried
      // no attachment and mentioned no file — the index never moved, because the offending content
      // was in the history rather than in that turn, so no message the user could send would
      // succeed. A provider's rejection is legible and correctly classified; what made it fatal was
      // the content outliving the request it was built for.
      //
      // `wrapModelCall` is what scopes it: the injected message goes into `handler`'s request and is
      // discarded when the call returns, so nothing this middleware builds can be replayed and
      // there is no history to prune after a failure. The default-on middleware rule that history
      // is not mutated is the same one, arrived at from the other side.
      //
      // **What the model sees afterwards:** the binary payload is visible on the model call that
      // directly follows the read, and not on later ones — if the model reads a file, calls another
      // tool, and then needs the bytes again, it re-reads the file. The `gth_read_binary`
      // ToolMessage itself stays in history exactly as before, so the fact that the file was read,
      // and its path, remain part of the conversation.
      wrapModelCall: async (request, handler) => {
        const messages = request.messages ?? [];

        // The gth_read_binary results this call continues from (the trailing ToolMessage run).
        const binaryMessages = collectTrailingBinaryContent(messages);

        // If we found binary content, add HumanMessage(s) to this request
        if (binaryMessages.length > 0) {
          debugLog(`Injecting ${binaryMessages.length} HumanMessage(s) with binary content`);

          const newMessages = [...messages];
          // What rode this request, in the user's words, for `noteRejectedAttachment` below.
          const attachments: string[] = [];

          for (const binaryData of binaryMessages) {
            const formatLabel = getFormatLabel(binaryData.formatType);
            // Images go through the per-provider builder so OpenAI reasoning models (Responses API,
            // GS2-74) get a valid `image_url` block instead of the standard `source_type` data block,
            // which @langchain/openai mis-serialises to an invalid Responses image part (GS2-75).
            //
            // Everything else keeps the standard block, and CFG-63 measured what each provider's
            // CLIENT then does with it — see {@link nonImageBinaryFateFor} for the per-provider
            // evidence. One label is measured to discard it silently: `xai-responses` rewrites the
            // block to an empty text part and sends a request that looks complete. There is no
            // better block to emit there, so the attachment is refused here instead, before the
            // call. `groq` was the one label its client could not settle — it forwards the block
            // untouched — so its server half was measured live instead: it rejects with a 400 the
            // user reads, which is loud, so nothing is refused for it here.
            //
            // Refusing from this hook is a deliberate departure from CFG-45's ruling that this
            // path must never throw, and the difference is the evidence. That ruling protects a
            // possibly-suboptimal block on a provider nobody has measured — it might still work.
            // Here the content is measured to be gone before the request is built, so the only
            // outcomes left are a refusal the user can act on and a confident answer about a file
            // the model never saw. The narrowness is the safeguard: only a MEASURED
            // `silently-discarded` label refuses, and everything else — including every
            // unenumerated label, and the `''` that arises only when there is no `llm` or its
            // `_llmType()` is missing or throws — behaves exactly as before.
            //
            // WHO THIS ACTUALLY FIRES FOR, measured rather than assumed: today only a module config
            // (`.gsloth.config.js`/`.mjs`/`.ts`) whose `configure()` returns a pre-built
            // `ChatXAIResponses`. A JSON config cannot produce this label — the loader sets
            // `modelProviderType` from `llm.type` and imports `#src/providers/<type>.js`, and there
            // is no `xai-responses` module, while gth's own `xai` provider only ever builds
            // `ChatXAI`. The module path never sets `modelProviderType`, so `resolveVisionProvider`
            // falls back to `_llmType()`, which is where `xai-responses` comes from. That is the
            // same narrow population CFG-45 shipped its `xai-responses` image arm for. So this is a
            // tripwire, correctly placed rather than widely load-bearing: it covers that config
            // shape today and whatever label measures as discarding tomorrow. Do NOT read the
            // narrow reach as a reason to widen it by analogy — measure, then add an arm.
            if (
              binaryData.formatType !== 'image' &&
              nonImageBinaryFateFor(provider) === 'silently-discarded'
            ) {
              const filename = path.basename(binaryData.path);
              throw new Error(
                `Refusing to send ${formatLabel} "${filename}" (${binaryData.media_type}) to ` +
                  `provider "${provider}": its message converter replaces every non-image ` +
                  `attachment with an empty text part, so the model would answer about content it ` +
                  `never received. No block shape reaches this provider — use a provider that ` +
                  `accepts ${formatLabel} attachments, or supply the content as text.`
              );
            }
            const contentBlock =
              binaryData.formatType === 'image'
                ? imageBlockFor(provider, binaryData.media_type, binaryData.data)
                : createContentBlock(binaryData);

            const humanMessage = new HumanMessage({
              content: [
                {
                  type: 'text',
                  text: `Here is the ${formatLabel} content from the file:`,
                },
                contentBlock,
              ] as MessageContent,
            });

            newMessages.push(humanMessage);
            attachments.push(`"${path.basename(binaryData.path)}" (${binaryData.media_type})`);
          }

          // Call the model with the attachment(s), and say what happened if it is rejected.
          try {
            return await handler({ ...request, messages: newMessages });
          } catch (error) {
            throw noteRejectedAttachment(error, attachments, provider);
          }
        }

        // No binary content, pass through
        return handler(request);
      },
    })
  );
}
