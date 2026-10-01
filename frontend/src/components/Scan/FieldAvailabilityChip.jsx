import { useState, useCallback } from 'react';
import {
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  List,
  ListItem,
  ListItemText,
  Typography,
  Tooltip,
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

// Status values that should *not* be surfaced as "unavailable" — e.g. when
// the server returned an entry with status "available", we ignore it.
const SURFACED_STATUSES = new Set(['unavailable', 'unsupported', 'missing', 'computed']);

/**
 * Per-row transparency chip. Renders when the scan result carries any
 * field_availability entries whose status means "not a clean supported
 * value", or when growth_metric_basis is the "unavailable" sentinel.
 *
 * Silent in the common US-quarterly case (empty/null availability dict),
 * so US rows stay visually quiet.
 */
function FieldAvailabilityChip({ fieldAvailability, growthMetricBasis }) {
  const [open, setOpen] = useState(false);

  // Recompute inline per render; fieldAvailability is small (≤5 keys in
  // practice) and TanStack Query returns a fresh object per refetch, so a
  // useMemo against that changing identity would bust on every render
  // anyway — the memo overhead outweighs the saved work.
  const entries = [];
  if (fieldAvailability && typeof fieldAvailability === 'object') {
    for (const [field, entry] of Object.entries(fieldAvailability)) {
      if (!entry || typeof entry !== 'object') continue;
      if (!SURFACED_STATUSES.has(entry.status)) continue;
      entries.push({ field, ...entry });
    }
  }

  const cadenceNote = growthMetricBasis === 'unavailable'
    ? '財務履歴が不足しているため、成長指標は未確認です。'
    : null;

  const count = entries.length;
  const handleOpen = useCallback((e) => {
    e.stopPropagation();
    setOpen(true);
  }, []);
  const handleClose = useCallback((e) => {
    e?.stopPropagation?.();
    setOpen(false);
  }, []);

  if (count === 0 && !cadenceNote) return null;

  const tooltipText = count > 0
    ? `${count}項目が未確認または代替計算です。詳細を確認`
    : '成長指標は未確認です。詳細を確認';

  return (
    <>
      <Tooltip title={tooltipText} arrow>
        <Chip
          size="small"
          icon={<InfoOutlinedIcon sx={{ fontSize: 12 }} />}
          label={count > 0 ? String(count) : '!'}
          onClick={handleOpen}
          aria-label="データの不足・計算方法を確認"
          sx={{
            minHeight: { xs: 44, md: 24 },
            fontSize: 12,
            ml: 0.5,
            '& .MuiChip-label': { px: 0.5 },
            '& .MuiChip-icon': { ml: 0.25, mr: -0.25 },
          }}
          color="warning"
          variant="outlined"
          data-testid="field-availability-chip"
        />
      </Tooltip>
      <Dialog open={open} onClose={handleClose} onClick={(e) => e.stopPropagation()}>
        <DialogTitle>データの不足・計算方法</DialogTitle>
        <DialogContent dividers>
          {cadenceNote && (
            <Typography variant="body2" sx={{ mb: entries.length ? 2 : 0 }}>
              {cadenceNote}
            </Typography>
          )}
          {entries.length > 0 && (
            <List dense disablePadding>
              {entries.map(({ field, status, reason_code }) => (
                <ListItem key={field} disableGutters>
                  <ListItemText
                    primary={{institutional_ownership:'機関保有比率',insider_ownership:'内部者保有比率',short_interest:'空売り残高',eps_growth_qq:'四半期EPS成長率',sales_growth_qq:'四半期売上成長率'}[field] || '未確認の項目'}
                    secondary={
                      reason_code
                        ? `${{computed:'代替計算',unsupported:'取得対象外',unavailable:'取得不可',missing:'未確認'}[status]} — ${{unsupported_market_policy_excludes_canonical_provider:'この市場は取得元の対象外',comparable_period_yoy_fallback:'比較可能な前年同期で計算',missing_supported_field_value:'取得元の値が欠損'}[reason_code] || '取得元の制約により確認できません'}`
                        : {computed:'代替計算',unsupported:'取得対象外',unavailable:'取得不可',missing:'未確認'}[status]
                    }
                    primaryTypographyProps={{
                      sx: { fontFamily: 'monospace', fontSize: 13 },
                    }}
                    secondaryTypographyProps={{ sx: { fontSize: 12 } }}
                  />
                </ListItem>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={handleClose}>閉じる</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export default FieldAvailabilityChip;
