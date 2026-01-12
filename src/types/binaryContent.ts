import type { BinaryFormatType } from '#src/config.js';

export interface BinaryContentData {
  __binaryContent: true;
  formatType: BinaryFormatType;
  media_type: string;
  data: string;
  path: string;
  size: number;
}
