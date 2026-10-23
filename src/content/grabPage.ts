// Runs in the page via chrome.scripting.executeScript when the user clicks "Read people on this page".
// Returns the rendered HTML so pages that draw their team with JavaScript can be read. Read-only.
// Must stay self-contained (Chrome serialises this function).
export function grabRenderedPage(): { url: string; html: string } {
  return { url: location.href, html: document.documentElement.outerHTML.slice(0, 3_000_000) };
}
