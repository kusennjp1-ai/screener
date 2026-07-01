import { useState } from 'react';
import { Box, ToggleButton, ToggleButtonGroup, IconButton, InputBase, Tooltip } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import TuneIcon from '@mui/icons-material/Tune';
import FunctionsIcon from '@mui/icons-material/Functions';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import PhotoCameraOutlinedIcon from '@mui/icons-material/PhotoCameraOutlined';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';

// Top chart toolbar: symbol search, D/W timeframe, the Indicators / $ / Ask MAI
// cluster, and the right-hand utilities — laid out to mirror Markets 360.
export default function ChartToolbar({ symbol, timeframe, onTimeframe, onSearch, onAskMai }) {
  const [query, setQuery] = useState('');
  const submit = (e) => {
    e.preventDefault();
    const v = query.trim().toUpperCase();
    if (v) onSearch?.(v);
  };
  const Icon = ({ title, children, onClick }) => (
    <Tooltip title={title}><IconButton size="small" sx={{ color: '#9aa0aa' }} onClick={onClick}>{children}</IconButton></Tooltip>
  );

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.5, bgcolor: '#0a0a0f', borderBottom: '1px solid #1c1f27' }}>
      <Box component="form" onSubmit={submit} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, bgcolor: '#13151c', borderRadius: 1, px: 1, height: 30 }}>
        <SearchIcon sx={{ fontSize: 16, color: '#787b86' }} />
        <InputBase
          value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder={symbol} sx={{ color: '#d1d4dc', fontSize: 13, width: 90 }}
        />
      </Box>
      <Icon title="Compare / add symbol"><AddIcon sx={{ fontSize: 18 }} /></Icon>

      <ToggleButtonGroup
        exclusive size="small" value={timeframe}
        onChange={(_, v) => v && onTimeframe(v)}
        sx={{
          height: 28,
          '& .MuiToggleButton-root': { color: '#787b86', border: 'none', px: 1, fontWeight: 700, fontSize: 13 },
          '& .Mui-selected': { color: '#3aa0ff !important', bgcolor: 'transparent !important' },
        }}
      >
        <ToggleButton value="daily">D</ToggleButton>
        <ToggleButton value="weekly">W</ToggleButton>
      </ToggleButtonGroup>

      <Box sx={{ width: '1px', height: 18, bgcolor: '#23262f', mx: 0.5 }} />
      <Icon title="Chart settings"><TuneIcon sx={{ fontSize: 18 }} /></Icon>
      <Icon title="Indicators"><FunctionsIcon sx={{ fontSize: 18 }} /></Icon>
      <Icon title="Currency / adjustments"><AttachMoneyIcon sx={{ fontSize: 18 }} /></Icon>
      <Box
        onClick={onAskMai}
        sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', color: '#d1d4dc', px: 1, fontSize: 13, fontWeight: 600 }}
      >
        <AutoAwesomeIcon sx={{ fontSize: 16, color: '#3aa0ff' }} /> Ask MAI
      </Box>

      <Box sx={{ flex: 1 }} />
      <Icon title="Fullscreen"><FullscreenIcon sx={{ fontSize: 18 }} /></Icon>
      <Icon title="Snapshot"><PhotoCameraOutlinedIcon sx={{ fontSize: 18 }} /></Icon>
      <Icon title="Help"><HelpOutlineIcon sx={{ fontSize: 18 }} /></Icon>
    </Box>
  );
}
