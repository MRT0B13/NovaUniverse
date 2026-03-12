/**
 * UndoStack — command pattern undo/redo with 50-step history.
 */

export interface Command {
  execute(): void;
  undo(): void;
  label: string;
}

const MAX_HISTORY = 50;

export class UndoStack {
  private history: Command[] = [];
  private pointer = -1;
  private onChange: (() => void) | null = null;

  constructor(onChange?: () => void) {
    this.onChange = onChange ?? null;
  }

  /** Execute a command and push it onto the stack */
  exec(cmd: Command): void {
    cmd.execute();
    // Discard anything after current pointer (branching)
    this.history = this.history.slice(0, this.pointer + 1);
    this.history.push(cmd);
    if (this.history.length > MAX_HISTORY) {
      this.history.shift();
    } else {
      this.pointer++;
    }
    this.onChange?.();
  }

  undo(): string | null {
    if (this.pointer < 0) return null;
    const cmd = this.history[this.pointer];
    cmd.undo();
    this.pointer--;
    this.onChange?.();
    return cmd.label;
  }

  redo(): string | null {
    if (this.pointer >= this.history.length - 1) return null;
    this.pointer++;
    const cmd = this.history[this.pointer];
    cmd.execute();
    this.onChange?.();
    return cmd.label;
  }

  canUndo(): boolean { return this.pointer >= 0; }
  canRedo(): boolean { return this.pointer < this.history.length - 1; }

  clear(): void {
    this.history = [];
    this.pointer = -1;
    this.onChange?.();
  }
}
