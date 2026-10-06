// Axe's normal analysis opens an extra page through page.context().newPage().
// Playwright's browser.newPage() convenience context forbids that operation.
// Own an explicit context per viewport and close it even if capture/Axe fails.
export async function withPreviewViewport(browser, viewport, origin, visit) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  try {
    // Apply the existing same-origin restriction to every page, including
    // Axe's extra page. This does not relax the accessibility checks.
    await context.route('**/*', route => {
      let allowed = false;
      try { allowed = new URL(route.request().url()).origin === origin; } catch { /* Invalid URLs are blocked. */ }
      return allowed ? route.continue() : route.abort();
    });
    return await visit(await context.newPage());
  } finally {
    await context.close();
  }
}
