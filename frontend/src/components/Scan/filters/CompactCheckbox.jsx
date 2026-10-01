import { Box, ToggleButtonGroup, ToggleButton, Typography } from '@mui/material';

const ALL_VALUE = '__all__';

/**
 * Compact tri-state toggle for boolean filters
 * States: null (All), true (Yes), false (No)
 */
function CompactCheckbox({ label, value, onChange }) {
  const handleChange = (event, newValue) => {
    if (newValue === null && value !== null) {
      onChange(null);
      return;
    }
    if (newValue === ALL_VALUE) {
      onChange(null);
      return;
    }
    onChange(newValue);
  };

  return (
    <Box sx={{ minWidth: 60 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', mb: 0.5, fontSize: '12px' }}
      >
        {label}
      </Typography>
      <ToggleButtonGroup
        value={value ?? ALL_VALUE}
        exclusive
        onChange={handleChange}
        size="small"
        sx={{
          height: 28,
          '& .MuiToggleButton-root': {
            padding: '2px 6px',
            fontSize: '12px',
            textTransform: 'none',
            minWidth: 28,
          },
        }}
      >
        <ToggleButton value={ALL_VALUE} aria-label={`${label}の指定なし`}>
          All
        </ToggleButton>
        <ToggleButton value={true} aria-label={`${label}あり`} sx={{ color: 'success.main' }}>
          Yes
        </ToggleButton>
        <ToggleButton value={false} aria-label={`${label}なし`} sx={{ color: 'error.main' }}>
          No
        </ToggleButton>
      </ToggleButtonGroup>
    </Box>
  );
}

export default CompactCheckbox;
