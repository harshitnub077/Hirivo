// Actions that open tabs, read sites or send email come only from Hirivo's own pages (side panel,
// offscreen document), never from a content script running inside a third-party page.
export const PRIVILEGED = new Set(['AP_START', 'TAB_SCRAPE', 'SEARCH_DONE', 'AP_CAN_READ', 'AP_READ_PAGE', 'AP_APPLY', 'AP_SEND', 'AP_NOTIFY']);

export function fromExtensionPage(sender: { id?: string; tab?: unknown; url?: string }, extensionId: string): boolean {
  return sender.id === extensionId && !sender.tab && (!sender.url || sender.url.startsWith(`chrome-extension://${extensionId}/`));
}
