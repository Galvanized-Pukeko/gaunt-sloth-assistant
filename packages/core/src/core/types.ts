export type StatusUpdateCallback = (level: StatusLevel, message: string) => void;

/**
 * Status level for logging and output control.
 * Levels are ordered by importance, with lower ordinal values being more verbose.
 * DEBUG (0) is most verbose, STREAM (6) is least verbose.
 */
export enum StatusLevel {
  DEBUG = 0,
  INFO = 1,
  DISPLAY = 2,
  SUCCESS = 3,
  WARNING = 4,
  ERROR = 5,
  STREAM = 6,
}
export type GthCommand = 'ask' | 'pr' | 'review' | 'chat' | 'code' | 'api';
