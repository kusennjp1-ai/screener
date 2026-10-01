import { useState } from 'react';
import {
  Box,
  Typography,
  Collapse,
  IconButton,
  Chip,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import StarIcon from '@mui/icons-material/Star';

const CATEGORY_CONFIG = {
  fundamental: {
    icon: AccountBalanceIcon,
    color: 'primary.main',
    bgColor: 'background.paper',
    borderColor: 'divider',
  },
  technical: {
    icon: ShowChartIcon,
    color: 'primary.main',
    bgColor: 'background.paper',
    borderColor: 'divider',
  },
  rating: {
    icon: StarIcon,
    color: 'primary.main',
    bgColor: 'background.paper',
    borderColor: 'divider',
  },
};

/**
 * Collapsible filter section with category-specific styling
 */
function FilterSection({
  title,
  category = 'fundamental',
  activeCount = 0,
  defaultExpanded = true,
  children
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const config = CATEGORY_CONFIG[category] || CATEGORY_CONFIG.fundamental;
  const IconComponent = config.icon;

  return (
    <Box
      sx={{
        mb: 1.5,
        borderRadius: 1,
        border: '1px solid',
        borderColor: config.borderColor,
        backgroundColor: config.bgColor,
        overflow: 'hidden',
      }}
    >
      {/* Section Header */}
      <Box
        onClick={() => setExpanded(!expanded)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          px: 1.5,
          py: 0.75,
          cursor: 'pointer',
          userSelect: 'none',
          '&:hover': {
            backgroundColor: 'action.hover',
          },
        }}
      >
        <IconComponent
          sx={{
            fontSize: 16,
            mr: 1,
            color: config.color,
          }}
        />
        <Typography
          variant="subtitle2"
          sx={{
            fontSize: '0.75rem',
            fontWeight: 600,
            color: config.color,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            flexGrow: 1,
          }}
        >
          {title}
        </Typography>

        {activeCount > 0 && (
          <Chip
            label={`${activeCount} active`}
            size="small"
            sx={{
              height: 18,
              fontSize: '12px',
              fontWeight: 500,
              backgroundColor: 'action.selected',
              color: 'text.primary',
              mr: 1,
              '& .MuiChip-label': { px: 1 },
            }}
          />
        )}

        <IconButton
          aria-label={`${title}を${expanded ? '閉じる' : '開く'}`}
          aria-expanded={expanded}
          size="small"
          sx={{
            p: 0.25, minWidth: { xs: 44, md: 24 }, minHeight: { xs: 44, md: 24 },
            color: config.color,
          }}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
        >
          {expanded ? (
            <ExpandLessIcon sx={{ fontSize: 18 }} />
          ) : (
            <ExpandMoreIcon sx={{ fontSize: 18 }} />
          )}
        </IconButton>
      </Box>

      {/* Section Content */}
      <Collapse in={expanded}>
        <Box sx={{ px: 1.5, pb: 1.5, pt: 0.5 }}>
          {children}
        </Box>
      </Collapse>
    </Box>
  );
}

export default FilterSection;
