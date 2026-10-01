import { Box, Autocomplete, TextField, Typography, Chip, IconButton, Tooltip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';

/**
 * Compact multi-select autocomplete for Industry/Sector filters
 * Supports include/exclude mode toggle
 */
function CompactMultiSelect({
  label,
  values,
  options,
  onChange,
  placeholder = 'Select...',
  mode = 'include',
  onModeChange,
  showModeToggle = false,
}) {
  const isExcludeMode = mode === 'exclude';

  const handleModeToggle = (e) => {
    e.stopPropagation();
    if (onModeChange) {
      onModeChange(isExcludeMode ? 'include' : 'exclude');
    }
  };

  return (
    <Box sx={{ minWidth: 140 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontSize: '12px', flexGrow: 1 }}
        >
          {label}
        </Typography>
        {showModeToggle && (
          <Tooltip title={isExcludeMode ? 'Excluding selected (click to include)' : 'Including selected (click to exclude)'}>
            <IconButton
              aria-label={`${label}を${isExcludeMode ? '含める' : '除外する'}`}
              size="small"
              onClick={handleModeToggle}
              sx={{
                p: 0,
                ml: 0.5,
                minWidth: { xs: 44, md: 24 },
                minHeight: { xs: 44, md: 24 },
                bgcolor: 'action.selected',
                color: isExcludeMode ? 'error.main' : 'primary.main',
                '&:hover': {
                  bgcolor: 'action.hover',
                },
              }}
            >
              {isExcludeMode ? (
                <RemoveIcon sx={{ fontSize: 14 }} />
              ) : (
                <AddIcon sx={{ fontSize: 14 }} />
              )}
            </IconButton>
          </Tooltip>
        )}
      </Box>
      <Autocomplete
        multiple
        clearText="選択を解除"
        openText="選択肢を開く"
        closeText="選択肢を閉じる"
        size="small"
        value={values || []}
        onChange={(event, newValue) => onChange(newValue)}
        options={options || []}
        disableCloseOnSelect
        renderInput={(params) => (
          <TextField
            {...params}
            inputProps={{ ...params.inputProps, 'aria-label': label }}
            placeholder={values?.length ? '' : placeholder}
            sx={{
              '& .MuiOutlinedInput-root': {
                minHeight: 28,
                padding: '2px 6px',
                fontSize: '0.75rem',
                ...(isExcludeMode && values?.length > 0 && {
                  borderColor: 'error.main',
                  '& fieldset': {
                    borderColor: 'error.light',
                  },
                  '&:hover fieldset': {
                    borderColor: 'error.main',
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: 'error.main',
                  },
                }),
              },
              '& .MuiAutocomplete-input': {
                padding: '2px 4px !important',
                fontSize: '0.75rem',
              },
            }}
          />
        )}
        renderTags={(value, getTagProps) =>
          value.map((option, index) => (
            <Chip
              {...getTagProps({ index })}
              key={option}
              label={option}
              size="small"
              color={isExcludeMode ? 'error' : 'default'}
              sx={{
                height: 20,
                fontSize: '12px',
                '& .MuiChip-label': {
                  px: 0.75,
                },
                '& .MuiChip-deleteIcon': {
                  fontSize: '0.8rem',
                },
              }}
            />
          ))
        }
        sx={{
          '& .MuiAutocomplete-tag': {
            margin: '1px',
          },
        }}
      />
    </Box>
  );
}

export default CompactMultiSelect;
