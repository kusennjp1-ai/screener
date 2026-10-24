// D1: the only color definitions for the static research application.
export const palettes = {
  dark: {
    ground:'#000000', panel:'#000000', surface:'#000000', 'surface-2':'#16181c', line:'#2f3336', 'line-2':'#2f3336',
    text:'#e7e9ea', 'text-2':'#e7e9ea', 'text-3':'#71767b', accent:'#1d9bf0', 'accent-ink':'#000000',
    zone:'#00ba7c', wait:'#1d9bf0', ext:'#e8b04a', neg:'#e5646e', neutral:'#71767b', up:'#00ba7c', down:'#e5646e',
    'zone-fill':'rgba(0,186,124,.10)', 'zone-edge':'rgba(0,186,124,.45)', grid:'rgba(255,255,255,.05)',
    glow:'rgba(0,186,124,.14)', scrim:'rgba(3,5,8,.62)', vol:'rgba(174,183,199,.26)', 'vol-hi':'rgba(0,186,124,.75)',
  },
  light: {
    ground:'#EEF1F5', panel:'#F6F7F9', surface:'#FFFFFF', 'surface-2':'#EDF0F5', line:'#E0E5EC', 'line-2':'#CCD3DE',
    text:'#0B0F16', 'text-2':'#434C5E', 'text-3':'#5A6477', accent:'#5543D0', 'accent-ink':'#FFFFFF',
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
