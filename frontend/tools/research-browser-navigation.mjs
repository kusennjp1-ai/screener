export async function readyResearchCandidates(page,selector='.candidate-row, .research-list tbody tr') {
  const browse=page.locator('.mobile-map-open-list');
  await page.locator(`${selector}, .mobile-map-open-list`).filter({visible:true}).first().waitFor({state:'visible',timeout:60000});
  if(await browse.isVisible()) await browse.click();
  await page.locator(selector).first().waitFor({state:'visible',timeout:60000});
}
