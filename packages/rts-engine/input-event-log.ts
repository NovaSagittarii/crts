export type InputLogEventKind = 'build' | 'destroy';

export interface InputLogEntry {
  tick: number;
  sequence: number;
  kind: InputLogEventKind;
  payload: unknown;
}

export class InputEventLog {
  private readonly buffer: (InputLogEntry | null)[];
  private head: number = 0;
  private _count: number = 0;

  public constructor(capacity: number) {
    this.buffer = new Array<InputLogEntry | null>(capacity).fill(null);
  }

  public get count(): number {
    return this._count;
  }

  public get capacity(): number {
    return this.buffer.length;
  }

  public append(entry: InputLogEntry): void {
    const index = (this.head + this._count) % this.buffer.length;
    if (this._count === this.buffer.length) {
      this.head = (this.head + 1) % this.buffer.length;
    } else {
      this._count += 1;
    }
    this.buffer[index] = entry;
  }

  public getEntriesFromTick(startTick: number): InputLogEntry[] {
    const result: InputLogEntry[] = [];
    for (let i = 0; i < this._count; i++) {
      const entry = this.buffer[(this.head + i) % this.buffer.length];
      if (entry && entry.tick >= startTick) {
        result.push(entry);
      }
    }
    return result;
  }

  public discardBefore(tick: number): void {
    while (this._count > 0) {
      const entry = this.buffer[this.head];
      if (!entry || entry.tick >= tick) break;
      this.buffer[this.head] = null;
      this.head = (this.head + 1) % this.buffer.length;
      this._count -= 1;
    }
  }

  public clear(): void {
    this.buffer.fill(null);
    this.head = 0;
    this._count = 0;
  }
}
