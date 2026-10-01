import { Box, FormControl, Select, MenuItem, Typography } from '@mui/material';

/**
 * Compact dropdown select for categorical filters
 */
function CompactSelect({ label, value, options, onChange, placeholder = '指定なし' }) {
  const handleChange = (e) => {
    const val = e.target.value;
    if (val === '') {
      onChange(null);
    } else {
      // Preserve original option value type (number vs string)
      const selectedOption = options.find(opt => String(opt.value) === String(val));
      onChange(selectedOption ? selectedOption.value : val);
    }
  };

  return (
    <Box sx={{ minWidth: 80 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', mb: 0.5, fontSize: '12px' }}
      >
        {label}
      </Typography>
      <FormControl size="small" fullWidth>
        <Select inputProps={{ 'aria-label': label }}
          value={value ?? ''}
          onChange={handleChange}
          displayEmpty
          sx={{
            minHeight: { xs: 44, md: 28 },
            fontSize: '0.75rem',
            '& .MuiSelect-select': {
              padding: '4px 8px',
            },
          }}
        >
          <MenuItem value="">
            <em>{placeholder}</em>
          </MenuItem>
          {options.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Box>
  );
}

export default CompactSelect;
