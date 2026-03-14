import { writeFileSync, existsSync } from 'node:fs';
import { GthCommand } from '#src/core/types.js';
import { fileSafeLocalDate, getGslothFilePath, toFileSafeString } from '#src/utils/fileUtils.js';

interface InlineBinaryBlock {
  index: number;
  mimeType: string;
  data: string;
}

const MIME_TYPE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'video/mp4': 'mp4',
};

function getMimeExtension(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase();
  if (MIME_TYPE_EXTENSIONS[normalized]) {
    return MIME_TYPE_EXTENSIONS[normalized];
  }

  const subtype = normalized.split('/')[1]?.split(';')[0]?.trim();
  if (!subtype) {
    return 'bin';
  }

  if (subtype === 'jpeg') {
    return 'jpg';
  }

  if (subtype.includes('+xml')) {
    return subtype.split('+')[0];
  }

  if (/^[a-z0-9]+$/.test(subtype) && subtype.length <= 4) {
    return subtype;
  }

  return 'bin';
}

function getBinaryOutputFilePath(command: GthCommand | undefined, extension: string): string {
  const dateTimeStr = fileSafeLocalDate();
  const commandStr = toFileSafeString((command ?? 'output').toUpperCase());
  const normalizedExtension = extension.replace(/^\./, '') || 'bin';
  const filename = `gth_${dateTimeStr}_${commandStr}.${normalizedExtension}`;
  const initialPath = getGslothFilePath(filename);

  if (!existsSync(initialPath)) {
    return initialPath;
  }

  const suffixBase = initialPath.slice(0, -(normalizedExtension.length + 1));
  for (let suffix = 2; ; suffix++) {
    const candidate = `${suffixBase}_${suffix}.${normalizedExtension}`;
    if (!existsSync(candidate)) {
      return candidate;
    }
  }
}

export function extractInlineBinaryBlocks(content: unknown): InlineBinaryBlock[] {
  if (!Array.isArray(content)) {
    return [];
  }

  return content.flatMap((block, index) => {
    if (
      block &&
      typeof block === 'object' &&
      'type' in block &&
      block.type === 'inlineData' &&
      'inlineData' in block &&
      block.inlineData &&
      typeof block.inlineData === 'object' &&
      'mimeType' in block.inlineData &&
      'data' in block.inlineData &&
      typeof block.inlineData.mimeType === 'string' &&
      typeof block.inlineData.data === 'string'
    ) {
      return [
        {
          index,
          mimeType: block.inlineData.mimeType,
          data: block.inlineData.data,
        },
      ];
    }

    return [];
  });
}

export function renderAssistantContent(
  content: unknown,
  binaryPlaceholders: Map<number, string> = new Map()
): string {
  if (content === undefined || content === null) {
    return '';
  }

  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return JSON.stringify(content) ?? '';
  }

  return content
    .map((block, index) => {
      if (binaryPlaceholders.has(index)) {
        return binaryPlaceholders.get(index);
      }
      if (typeof block === 'string') {
        return block;
      }
      if (block && typeof block === 'object' && 'type' in block && block.type === 'text') {
        if ('text' in block && typeof block.text === 'string') {
          return block.text;
        }
      }
      return JSON.stringify(block);
    })
    .filter((part): part is string => !!part && part.trim().length > 0)
    .join('\n');
}

export function materializeBinaryOutputs(
  content: unknown,
  command: GthCommand | undefined
): { renderedContent: string; successMessages: string[] } {
  const binaryBlocks = extractInlineBinaryBlocks(content);

  if (binaryBlocks.length === 0) {
    return {
      renderedContent: renderAssistantContent(content),
      successMessages: [],
    };
  }

  const placeholderMap = new Map<number, string>();
  const successMessages: string[] = [];

  for (const binaryBlock of binaryBlocks) {
    const extension = getMimeExtension(binaryBlock.mimeType);
    const filePath = getBinaryOutputFilePath(command, extension);
    writeFileSync(filePath, Buffer.from(binaryBlock.data, 'base64'));

    const placeholder = `[Binary model output saved: ${binaryBlock.mimeType} -> ${filePath}]`;
    placeholderMap.set(binaryBlock.index, placeholder);
    successMessages.push(`Wrote model output (${binaryBlock.mimeType}) to ${filePath}`);
  }

  return {
    renderedContent: renderAssistantContent(content, placeholderMap),
    successMessages,
  };
}
