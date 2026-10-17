import { Alert } from '@mui/material';
import { limitedResearchPreview } from '../limitedResearchPreview.js';

export default function LimitedResearchPreviewNotice() {
  const preview = limitedResearchPreview();
  if (!preview) return null;
  return <Alert severity="warning" role="note" aria-label="限定リサーチプレビュー" data-preview-scope={preview.version} sx={{ m: 1, flexShrink: 0 }}>
    <strong>限定リサーチプレビュー · {preview.version}</strong><br />
    {preview.notice}
  </Alert>;
}
