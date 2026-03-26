import { stdout } from '#src/utils/systemUtils.js';

export class ProgressIndicator {
  private interval: number | undefined = undefined;

  constructor(initialMessage: string, manual?: boolean) {
    stdout.write(initialMessage);
    if (!manual) {
      this.interval = setInterval(this.indicateInner, 1000) as unknown as number;
    }
  }

  private indicateInner(): void {
    stdout.write('.');
  }

  indicate(): void {
    if (this.interval) {
      throw new Error('ProgressIndicator.indicate only to be called in manual mode');
    }
    this.indicateInner();
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
    }
    stdout.write('\n');
  }
}
