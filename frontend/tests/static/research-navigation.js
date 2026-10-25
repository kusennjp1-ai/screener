// Exercise the visible mobile entry point before tests of the candidate list.
// Tests of the market map itself deliberately keep the default landing screen.
export async function openResearchList(page) {
  if (page.viewportSize().width <= 700) {
    await page.getByRole('button', { name: '一覧・絞り込みで探す →', exact: true }).click();
  }
}
