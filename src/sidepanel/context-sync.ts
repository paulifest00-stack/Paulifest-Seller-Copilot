import type { TabContextState } from '../shared/tab-context-contracts.ts';

/** Broadcasts only invalidate the view; re-read this window's active tab.
 * Never consume state supplied by an unrelated tab/window's broadcast.
 */
export class SidepanelContextSync {
  private revision = 0;
  constructor(
    private readRelevantContext: () => Promise<TabContextState | null>,
    private apply: (state: TabContextState | null) => void,
    private invalidateView: () => void = () => {}
  ) {}
  async refresh(): Promise<void> {
    const revision = ++this.revision;
    this.invalidateView();
    let state: TabContextState | null;
    try { state = await this.readRelevantContext(); } catch { state = null; }
    if (revision === this.revision) this.apply(state);
  }
  dispose(): void { ++this.revision; }
}

export async function readPanelContext(): Promise<TabContextState | null> {
  const window = await chrome.windows.getCurrent();
  return await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TAB_CONTEXT', windowId: window.id });
}
