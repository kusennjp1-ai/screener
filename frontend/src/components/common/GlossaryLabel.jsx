import { Box, Tooltip, Typography } from '@mui/material';
import { INDICATOR_GLOSSARY, EXECUTION_STATE_GLOSSARY } from '../../utils/indicatorGlossary';

// Wraps an English indicator label so tapping/long-pressing it shows the
// Japanese meaning + how to read its value. Touch-friendly (enterTouchDelay 0).
// `term` keys into INDICATOR_GLOSSARY (or EXECUTION_STATE_GLOSSARY when
// `kind="execution"`). Unknown terms render the children as-is (no tooltip).
function GlossaryTooltipContent({ entry }) {
  return (
    <Box sx={{ py: 0.25 }}>
      <Typography sx={{ fontWeight: 700, fontSize: 12, mb: 0.25 }}>{entry.title}</Typography>
      <Typography sx={{ fontSize: 11, lineHeight: 1.5 }}>{entry.jp}</Typography>
      {entry.how ? (
        <Typography sx={{ fontSize: 11, lineHeight: 1.5, mt: 0.5, color: '#9fd8a0' }}>
          📈 {entry.how}
        </Typography>
      ) : null}
    </Box>
  );
}

function GlossaryLabel({ term, kind = 'indicator', children, sx }) {
  const table = kind === 'execution' ? EXECUTION_STATE_GLOSSARY : INDICATOR_GLOSSARY;
  const entry = term ? table[term] : null;

  if (!entry) {
    return <Box component="span" sx={sx}>{children}</Box>;
  }

  return (
    <Tooltip
      title={<GlossaryTooltipContent entry={entry} />}
      arrow
      enterTouchDelay={0}
      leaveTouchDelay={8000}
      placement="top"
    >
      <Box
        component="span"
        sx={{
          cursor: 'help',
          borderBottom: '1px dotted',
          borderColor: 'text.disabled',
          ...sx,
        }}
      >
        {children}
      </Box>
    </Tooltip>
  );
}

export default GlossaryLabel;
