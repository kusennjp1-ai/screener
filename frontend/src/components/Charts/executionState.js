// Shared execution-state presentation (label + color), used by the chart info
// strip and the metrics sidebar so the two never drift. Pre-breakout / Breakout
// are buyable (green); Early-post is amber; Extended / Overextended / Damaged /
// Invalid are red.
export const EXECUTION_STATE_LABEL = {
  pre_breakout: 'Pre-breakout',
  breakout: 'Breakout',
  early_post_breakout: 'Early post',
  extended: 'Extended',
  overextended: 'Overextended',
  damaged: 'Damaged',
  invalid: 'Invalid',
};

export const EXECUTION_STATE_COLOR = {
  pre_breakout: '#4CF64D',
  breakout: '#4CF64D',
  early_post_breakout: '#FFB300',
  extended: '#E619CD',
  overextended: '#E619CD',
  damaged: '#E619CD',
  invalid: '#E619CD',
};
