// D1: the only color definitions for the static research application.
export const palettes = {
  dark: {
    ground:'#10121D', panel:'#181B29', surface:'#1D2132', 'surface-2':'#252A3D', line:'#343B51', 'line-2':'#46516B',
    text:'#F0F2FA', 'text-2':'#CBD1E3', 'text-3':'#A2ADC5', accent:'#B8A4FF', 'accent-ink':'#19152D',
    rail:'#171329', 'rail-text':'#E4DDF8', 'rail-muted':'#B7AECD', 'rail-active':'#39304F',
    zone:'#57D5AD', wait:'#93B6FF', ext:'#F0C273', neg:'#FF91A0', neutral:'#A2ADC5', up:'#57D5AD', down:'#FF91A0',
    'zone-fill':'rgba(0,186,124,.10)', 'zone-edge':'rgba(0,186,124,.45)', grid:'rgba(255,255,255,.05)',
    glow:'rgba(0,186,124,.14)', scrim:'rgba(3,5,8,.62)', vol:'rgba(174,183,199,.26)', 'vol-hi':'rgba(0,186,124,.75)',
  },
  light: {
    ground:'#F3F4F8', panel:'#FFFFFF', surface:'#FFFFFF', 'surface-2':'#F0EEF8', line:'#E0E2ED', 'line-2':'#C6CBDD',
    text:'#222238', 'text-2':'#50516B', 'text-3':'#676A82', accent:'#6551C8', 'accent-ink':'#FFFFFF',
    rail:'#29223D', 'rail-text':'#F4EFFD', 'rail-muted':'#C0B7D2', 'rail-active':'#4A3D67',
    zone:'#0B7553', wait:'#1C5CC2', ext:'#865700', neg:'#B0344A', neutral:'#4B5567', up:'#12966B', down:'#D2455A',
    'zone-fill':'rgba(11,117,83,.08)', 'zone-edge':'rgba(11,117,83,.45)', grid:'rgba(12,18,30,.06)',
    glow:'rgba(11,117,83,.10)', scrim:'rgba(20,24,32,.32)', vol:'rgba(67,76,94,.22)', 'vol-hi':'rgba(11,117,83,.70)',
  },
};
export const fontSizes = [42,34,26,20,16,14,13,12,11];
export const radii = [4,8,12,16];
// Local/system fonts keep offline and origin-pinned builds self-contained.
export const fonts = {
  body:'-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans CJK JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif',
  mono:'"SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
};
export const themeCss = Object.entries(palettes).map(([mode,palette]) =>
  `:root[data-theme="${mode}"],.leader-shell[data-theme="${mode}"]{${Object.entries(palette).map(([key,value])=>`--${key}:${value}`).join(';')};--font-body:${fonts.body};--font-mono:${fonts.mono};color-scheme:${mode}}`
).join('\n');
export function researchTheme(mode) {
  const p=palettes[mode] || palettes.dark;
  return {
    palette:{mode,primary:{main:p.accent,contrastText:p['accent-ink']},secondary:{main:p.wait},
      background:{default:p.ground,paper:p.surface},text:{primary:p.text,secondary:p['text-2'],disabled:p['text-3']},
      success:{main:p.zone},error:{main:p.neg},warning:{main:p.ext},info:{main:p.wait},divider:p.line},
    typography:{fontFamily:fonts.body,fontSize:14,h1:{fontSize:42,fontWeight:700},h2:{fontSize:34,fontWeight:700},h3:{fontSize:26},h4:{fontSize:20},h5:{fontSize:16},h6:{fontSize:14},body1:{fontSize:14},body2:{fontSize:13},caption:{fontSize:12},overline:{fontSize:11},button:{fontSize:13,textTransform:'none'}},
    shape:{borderRadius:8},
    components:{MuiPaper:{styleOverrides:{root:{backgroundImage:'none',boxShadow:'none'}}},MuiButton:{styleOverrides:{root:{minHeight:24,minWidth:24}}},MuiIconButton:{styleOverrides:{root:{minHeight:24,minWidth:24}}},MuiChip:{styleOverrides:{root:{fontSize:11},label:{fontSize:11}}},MuiInputBase:{styleOverrides:{input:{minHeight:24}}},MuiTooltip:{styleOverrides:{tooltip:{fontSize:12}}}},
  };
}
