import { useCallback, useState } from 'react';
import { Box, Popover, TableCell, Typography } from '@mui/material';
import { getGlossaryEntry, hasGlossaryEntry } from '../../constants/metricGlossary';

// 指標解説ポップオーバー。指標ラベルのクリックで意味と見方を表示する。
export function MetricInfoPopover({ anchorEl, entry, onClose }) {
  return (
    <Popover
      open={Boolean(anchorEl && entry)}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{ paper: { sx: { maxWidth: 340 } } }}
    >
      {entry ? (
        <Box sx={{ p: 1.5 }} data-testid="metric-info-popover">
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
            {entry.title}
          </Typography>
          <Typography variant="body2" sx={{ fontSize: '12px', lineHeight: 1.6 }}>
            {entry.meaning}
          </Typography>
          {entry.reading ? (
            <>
              <Typography
                variant="caption"
                sx={{ display: 'block', mt: 1, fontWeight: 700, color: 'text.secondary' }}
              >
                見方
              </Typography>
              <Typography variant="body2" sx={{ fontSize: '12px', lineHeight: 1.6 }}>
                {entry.reading}
              </Typography>
            </>
          ) : null}
        </Box>
      ) : null}
    </Popover>
  );
}

// 各テーブル/ページで共通に使うためのフック。
// openInfo(event, glossaryId) をクリックハンドラに渡し、popover を描画する。
export function useMetricInfoPopover() {
  const [state, setState] = useState(null);

  const openInfo = useCallback((event, id) => {
    const entry = getGlossaryEntry(id);
    if (!entry) return;
    event.stopPropagation();
    setState({ anchorEl: event.currentTarget, entry });
  }, []);

  const closeInfo = useCallback(() => setState(null), []);

  const popover = (
    <MetricInfoPopover
      anchorEl={state?.anchorEl ?? null}
      entry={state?.entry ?? null}
      onClose={closeInfo}
    />
  );

  return { openInfo, closeInfo, popover };
}

// 用語集エントリがある場合にクリックで解説を表示するテーブルヘッダーセル
export function GlossaryHeaderCell({ glossaryId, openInfo, align = 'center', children, sx }) {
  const clickable = hasGlossaryEntry(glossaryId);
  return (
    <TableCell
      align={align}
      onClick={clickable ? (event) => openInfo(event, glossaryId) : undefined}
      title={clickable ? 'クリックで指標の説明を表示' : undefined}
      sx={{
        ...(clickable ? {
          cursor: 'help',
          textDecoration: 'underline dotted',
          textUnderlineOffset: '3px',
        } : {}),
        ...sx,
      }}
    >
      {children}
    </TableCell>
  );
}

export default MetricInfoPopover;
