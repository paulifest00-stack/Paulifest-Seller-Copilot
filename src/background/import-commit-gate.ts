/** FIFO for import attempts only. Never delays navigation or auth invalidation. */
export class ImportCommitGate {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  isBlocked(): boolean { return this.pending > 0; }
  commit<T>(operation: () => Promise<T>): Promise<T> {
    ++this.pending;
    const result = this.tail.then(operation);
    this.tail = result.then(() => {}, () => {});
    return result.finally(() => { --this.pending; });
  }
}
export const importCommitGate = new ImportCommitGate();
