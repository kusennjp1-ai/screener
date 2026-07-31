import { Box, Typography } from '@mui/material';

function TickerCell({ symbol, companyName, align = 'left' }) {
  const alignItems = align === 'center' ? 'center' : 'flex-start';
  const textAlign = align === 'center' ? 'center' : 'left';
  // When the company name is unknown the backend falls back to the symbol, and
  // the cell then printed the ticker twice ("PRAX / PRAX") — which reads as a
  // rendering bug, not as missing data. A second line only earns its space if
  // it says something the first line does not.
  const subtitle = companyName && String(companyName).trim().toUpperCase() !== String(symbol || '').trim().toUpperCase()
    ? companyName
    : null;

  if (!symbol) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems,
          gap: 0.25,
          minWidth: 0,
        }}
      >
        <Typography
          component="span"
          variant="body2"
          color="text.secondary"
          sx={{ lineHeight: 1.2 }}
        >
          -
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems,
        gap: 0.25,
        minWidth: 0,
      }}
    >
      <Typography
        component="span"
        variant="body2"
        sx={{ fontWeight: 600, lineHeight: 1.2 }}
      >
        {symbol}
      </Typography>
      {subtitle ? (
        <Typography
          variant="caption"
          color="text.secondary"
          noWrap
          title={subtitle}
          sx={{
            display: 'block',
            lineHeight: 1.2,
            minWidth: 0,
            maxWidth: '100%',
            textAlign,
          }}
        >
          {subtitle}
        </Typography>
      ) : null}
    </Box>
  );
}

export default TickerCell;
