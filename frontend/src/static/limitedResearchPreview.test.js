import { describe, expect, it } from 'vitest';
import { limitedResearchPreview, limitedResearchPreviewCsvMetadata, previewBuildMetadata, LIMITED_RESEARCH_PREVIEW_NOTICE } from './limitedResearchPreview.js';
describe('limited preview presentation contract', () => {
  it('defaults off with no CSV metadata', () => {
    expect(previewBuildMetadata(undefined)).toBeNull();
    expect(previewBuildMetadata('')).toBeNull();
    expect(limitedResearchPreview(null)).toBeNull();
    expect(limitedResearchPreviewCsvMetadata(null)).toEqual({headers:[],values:[]});
  });
  it('accepts only explicit v1 build activation', () => {
    for (const flag of ['true','false','v2',' v1 ',null,false]) expect(() => previewBuildMetadata(flag)).toThrow();
    const preview=limitedResearchPreview(previewBuildMetadata('v1'));
    expect(preview.notice).toBe(LIMITED_RESEARCH_PREVIEW_NOTICE);
    expect(limitedResearchPreviewCsvMetadata(preview).values).toEqual(['limited_research_preview','limited-research-preview-v1',preview.notice]);
  });
  it('rejects malformed or expanded injected contracts', () => {
    for(const metadata of [{},false,{schema_version:'v2',scope_id:'v2'},{...previewBuildMetadata('v1'),expires_at:'2026-10-17'}]) expect(()=>limitedResearchPreview(metadata)).toThrow();
  });
  it('keeps fixed limits explicit without claiming freshness or qualification', () => {
    expect(LIMITED_RESEARCH_PREVIEW_NOTICE).toContain('公開審査で認められたデータセットを固定');
    expect(LIMITED_RESEARCH_PREVIEW_NOTICE).toContain('元の基準日・公開日を表示');
    expect(LIMITED_RESEARCH_PREVIEW_NOTICE).toContain('全面的な公開審査が完了したリリースまでは、データの自動更新を停止');
    expect(LIMITED_RESEARCH_PREVIEW_NOTICE).toContain('通常の性能基準を超える');
    expect(LIMITED_RESEARCH_PREVIEW_NOTICE).toContain('期限切れ・鮮度不明の財務データは未確認');
    expect(LIMITED_RESEARCH_PREVIEW_NOTICE).toContain('必須条件が未確認の銘柄は適格と判定しません');
  });
});
