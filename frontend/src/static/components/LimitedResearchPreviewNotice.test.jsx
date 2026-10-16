import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import LimitedResearchPreviewNotice from './LimitedResearchPreviewNotice.jsx';
import { limitedResearchPreview, LIMITED_RESEARCH_PREVIEW_NOTICE } from '../limitedResearchPreview.js';
vi.mock('../limitedResearchPreview.js', async importOriginal => ({...await importOriginal(),limitedResearchPreview:vi.fn()}));
afterEach(cleanup);
it('renders nothing for ordinary builds',()=>{
  limitedResearchPreview.mockReturnValue(null);
  const {container}=render(<LimitedResearchPreviewNotice/>);
  expect(container).toBeEmptyDOMElement();
});
it('renders a visible permanent versioned limitation notice',()=>{
  limitedResearchPreview.mockReturnValue({version:'limited-research-preview-v1',notice:LIMITED_RESEARCH_PREVIEW_NOTICE});
  render(<LimitedResearchPreviewNotice/>);
  expect(screen.getByRole('note')).toBeVisible();
  expect(screen.getByRole('note')).toHaveAttribute('data-preview-scope','limited-research-preview-v1');
  expect(screen.getByText(LIMITED_RESEARCH_PREVIEW_NOTICE)).toBeVisible();
});
