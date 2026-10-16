/* global __LIMITED_RESEARCH_PREVIEW__ */
// Presentation only: this metadata grants no publication or qualification authority.
// Once enabled, the warning remains visible for the artifact's entire lifetime.
export const LIMITED_RESEARCH_PREVIEW_VERSION = 'limited-research-preview-v1';
export const LIMITED_RESEARCH_PREVIEW_NOTICE = '限定リサーチプレビュー：公開審査で認められたデータセットを固定し、元の基準日・公開日を表示しています。全面的な公開審査が完了したリリースまでは、データの自動更新を停止しています。表示速度が通常の性能基準を超える場合があります。期限切れ・鮮度不明の財務データは未確認のままです。必須条件が未確認の銘柄は適格と判定しません。通常公開の検証完了を示すものではありません。';
export function previewBuildMetadata(flag) {
  if (flag === undefined || flag === '') return null;
  if (flag !== 'v1') throw new Error('Invalid VITE_LIMITED_RESEARCH_PREVIEW: expected v1 or unset');
  return { schema_version: LIMITED_RESEARCH_PREVIEW_VERSION, scope_id: LIMITED_RESEARCH_PREVIEW_VERSION };
}
export function limitedResearchPreview(metadata = typeof __LIMITED_RESEARCH_PREVIEW__ === 'undefined' ? null : __LIMITED_RESEARCH_PREVIEW__) {
  if (metadata === null) return null;
  if (!metadata || metadata.schema_version !== LIMITED_RESEARCH_PREVIEW_VERSION || metadata.scope_id !== LIMITED_RESEARCH_PREVIEW_VERSION || Object.keys(metadata).length !== 2) {
    throw new Error('Invalid limited research preview build metadata');
  }
  return { version: LIMITED_RESEARCH_PREVIEW_VERSION, notice: LIMITED_RESEARCH_PREVIEW_NOTICE };
}
export function limitedResearchPreviewCsvMetadata(preview = limitedResearchPreview()) {
  if (!preview) return { headers: [], values: [] };
  return {
    headers: ['release_scope', 'release_scope_version', 'release_scope_notice'],
    values: ['limited_research_preview', preview.version, preview.notice],
  };
}
