import { Box, Chip, Divider, Tooltip } from '@mui/material';

const PRESET_LABELS = {minervini:'ミネルヴィニ',minervini_vcp:'ミネルヴィニ VCP',minervini_usic:'投資大会型',canslim:'CAN SLIM',ibd_composite:'IBD 85-85',ibd50:'IBD型上位50',vcp:'VCP',blue_dot_leaders:'RS先行高値',vol_break:'出来高ブレイク',episodic_pivot:'材料急騰',momentum:'上昇持続',kell_growth:'ケル型成長',rs_power:'強いRS',leaders_in_leading_groups:'上位業種の先導銘柄',new_highs:'新高値',pocket_pivot:'ポケットピボット',power_trend:'強い上昇トレンド',accumulation:'買い集積',se_cup_handle:'カップ・ウィズ・ハンドル',se_double_bottom:'ダブルボトム',se_high_tight_flag:'ハイ・タイト・フラッグ',se_first_pullback:'初回の押し',se_three_weeks_tight:'3週タイト',se_nr7_inside_day:'NR7・インサイドデイ',gainers_4pct:'前日比4%以上',movers_9m:'大商い銘柄',movers_20_weekly:'週間20%以上',club_97:'騰落上位3%'};
const presetLabel = screen => `補助 ${PRESET_LABELS[screen.id] || '追加条件'}`;

const chipSx = (isActive) => ({
  fontSize: {xs:'13px',md:'12px'},
  minHeight:44,
  fontWeight: isActive ? 600 : 400,
  cursor: 'pointer',
  '& .MuiChip-label': { px: 1 },
});

function ScreenSelector({ screens, activeScreenId, onSelectScreen, matchCounts }) {
  if (!screens?.length) return null;

  const tier1 = screens.filter((s) => s.tier === 1);
  const tier2 = screens.filter((s) => s.tier !== 1);

  const renderChip = (screen) => {
    const isActive = activeScreenId === screen.id;
    const count = matchCounts?.[screen.id];
    const label = count != null ? `${presetLabel(screen)} (${count})` : presetLabel(screen);

    return (
      <Tooltip describeChild key={screen.id} title={count === 0 ? '該当なし' : `${presetLabel(screen)} · 独自の補助フィルター`} arrow>
        <span><Chip
          disabled={count === 0}
          label={label}
          size="small"
          variant={isActive ? 'filled' : 'outlined'}
          color={isActive ? 'primary' : 'default'}
          onClick={() => onSelectScreen(isActive ? null : screen.id)}
          sx={chipSx(isActive)}
        /></span>
      </Tooltip>
    );
  };

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        overflowX: 'auto',
        pb: 0.5,
        mb: 1.5,
        '&::-webkit-scrollbar': { height: 4 },
        '&::-webkit-scrollbar-thumb': { borderRadius: 2, bgcolor: 'divider' },
      }}
    >
      <Chip
        label="全銘柄"
        size="small"
        variant={activeScreenId == null ? 'filled' : 'outlined'}
        color={activeScreenId == null ? 'primary' : 'default'}
        onClick={() => onSelectScreen(null)}
        sx={chipSx(activeScreenId == null)}
      />
      {tier1.map(renderChip)}
      {tier2.length > 0 && (
        <Divider orientation="vertical" flexItem sx={{ mx: 0.25 }} />
      )}
      {tier2.map(renderChip)}
    </Box>
  );
}

export default ScreenSelector;
