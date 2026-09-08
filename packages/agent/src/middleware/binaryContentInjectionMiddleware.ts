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
 * 3. Injects HumanMessage with binary content blocks before next model call
 * 4. Refuses a non-image attachment bound for a provider measured to discard it silently
 *    (see {@link nonImageBinaryFateFor})
 *
 * This works around LangChain's limitation where ToolMessage doesn't properly
 * support binary content blocks for most providers.
 */

import { createMiddleware, type AgentMiddleware } from 'langchain';
import path from 'node:path';
import type { GthConfig } from '@gaunt-sloth/core/config.js';
import { debugLog } from '@gaunt-sloth/core/utils/debugUtils.js';
import { ToolMessage, HumanMessage } from '@langchain/core/messages';
import type { MessageContent } from '@langchain/core/messages';
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
 * - `delivered-or-loud` — either the data reaches the request body, or the attempt fails where
 *   somebody sees it (a client-side throw, or a shape the provider's API rejects). Either way the
 *   user finds out; gth stays out of the way.
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
 * - `groq` → delivered-or-loud. `@langchain/groq@1.3.1` `dist/chat_models.js:82` assigns
 *   `content: message.content` verbatim, so the block reaches the wire unchanged and Groq's API
 *   decides. Not an in-process discard: the payload leaves the machine and the answer comes back
 *   from the server, which is where this one is knowable. **What that server does with it was not
 *   measured** — establishing it needs a live call, which this node forbids. So this arm asserts the
 *   client half only. The specific possibility it cannot rule out is the one this whole check exists
 *   to catch: Groq accepting the request and ignoring the unrecognised part, which would make `groq`
 *   a second `silently-discarded` label. Anyone who can make one live call should settle it.
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

      // Before next model call, detect and inject HumanMessage with binary content
      beforeModel: async (state) => {
        const messages = state.messages || [];

        // Find recent ToolMessages from gth_read_binary
        const binaryMessages: Array<{ message: ToolMessage; binaryData: ParsedBinaryContent }> = [];

        // Check last few messages (usually just need to check the most recent)
        for (let i = messages.length - 1; i >= Math.max(0, messages.length - 5); i--) {
          const msg = messages[i];
          if (
            msg instanceof ToolMessage &&
            msg.name === 'gth_read_binary' &&
            typeof msg.content === 'string'
          ) {
            const parsedContent = parseBinaryContent(msg.content);
            if (parsedContent) {
              binaryMessages.push({ message: msg, binaryData: parsedContent });
            }
          }
        }

        // If we found binary content, inject HumanMessage(s)
        if (binaryMessages.length > 0) {
          debugLog(`Injecting ${binaryMessages.length} HumanMessage(s) with binary content`);

          const newMessages = [...messages];

          for (const { binaryData } of binaryMessages) {
            const formatLabel = getFormatLabel(binaryData.formatType);
            // Images go through the per-provider builder so OpenAI reasoning models (Responses API,
            // GS2-74) get a valid `image_url` block instead of the standard `source_type` data block,
            // which @langchain/openai mis-serialises to an invalid Responses image part (GS2-75).
            //
            // Everything else keeps the standard block, and CFG-63 measured what each provider then
            // does with it — see {@link nonImageBinaryFateFor} for the per-provider evidence. The
            // standard block is right, or at least loudly wrong, on every provider measured except
            // one: `xai-responses` rewrites it to an empty text part and sends a request that looks
            // complete. There is no better block to emit there, so the attachment is refused here
            // instead, before the call.
            //
            // Refusing from `beforeModel` is a deliberate departure from CFG-45's ruling that this
            // path must never throw, and the difference is the evidence. That ruling protects a
            // possibly-suboptimal block on a provider nobody has measured — it might still work.
            // Here the content is measured to be gone before the request is built, so the only
            // outcomes left are a refusal the user can act on and a confident answer about a file
            // the model never saw. The narrowness is the safeguard: only a MEASURED
            // `silently-discarded` label refuses, and everything else — including every
            // unenumerated label and the `''` a module config yields — behaves exactly as before.
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
          }

          // Return the modified state with new messages
          return {
            messages: newMessages,
          };
        }

        // No binary content, pass through
        return undefined;
      },
    })
  );
}
