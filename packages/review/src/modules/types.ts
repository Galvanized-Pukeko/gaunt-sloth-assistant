import type { BaseMessage } from '@langchain/core/messages';

export type Message = BaseMessage;

export interface State {
  messages: Message[];
}

export interface ProgressCallback {
  (): void;
}

export interface ReviewOptions {
  source: string;
  preamble: string;
  diff: string;
}

export interface QuestionOptions {
  source: string;
  preamble: string;
  content: string;
}
