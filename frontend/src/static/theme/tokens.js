// D1: the only color definitions for the static research application.
export const palettes = {
  dark: {
    ground:'#07090D', panel:'#0C1016', surface:'#10151E', 'surface-2':'#161D29', line:'#1C2430', 'line-2':'#29333F',
    text:'#EEF1F6', 'text-2':'#AEB7C7', 'text-3':'#8791A5', accent:'#AFA3FF', 'accent-ink':'#140F2E',
    zone:'#5FE3B1', wait:'#8DBBFF', ext:'#F4C56A', neg:'#FF8E8E', neutral:'#9CA6B7', up:'#48D6A0', down:'#F0707A',
    'zone-fill':'rgba(95,227,177,.10)', 'zone-edge':'rgba(95,227,177,.45)', grid:'rgba(255,255,255,.05)',
    glow:'rgba(95,227,177,.14)', scrim:'rgba(3,5,8,.62)', vol:'rgba(174,183,199,.26)', 'vol-hi':'rgba(95,227,177,.75)',
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
export const fonts = { body:'"Zen Kaku Gothic New", sans-serif', mono:'"Geist Mono", monospace' };
export const themeCss = Object.entries(palettes).map(([mode,palette]) =>
  `:root[data-theme="${mode}"],.leader-shell[data-theme="${mode}"]{${Object.entries(palette).map(([key,value])=>`--${key}:${value}`).join(';')};color-scheme:${mode}}`
).join('\n');
export function researchTheme(mode) {
  const p=palettes[mode] || palettes.dark;
  return {
    palette:{mode,primary:{main:p.accent,contrastText:p['accent-ink']},secondary:{main:p.wait},
      background:{default:p.ground,paper:p.surface},text:{primary:p.text,secondary:p['text-2'],disabled:p['text-3']},
      success:{main:p.zone},error:{main:p.neg},warning:{main:p.ext},info:{main:p.wait},divider:p.line},
    typography:{fontFamily:fonts.body,fontSize:14,h1:{fontSize:42,fontWeight:700},h2:{fontSize:34,fontWeight:700},h3:{fontSize:26},h4:{fontSize:20},h5:{fontSize:16},h6:{fontSize:14},body1:{fontSize:14},body2:{fontSize:13},caption:{fontSize:12},overline:{fontSize:11},button:{fontSize:13,textTransform:'none'}},
    shape:{borderRadius:8},
    components:{MuiPaper:{styleOverrides:{root:{backgroundImage:'none',boxShadow:'none'}}},MuiButton:{styleOverrides:{root:{minHeight:24,minWidth:24}}},MuiIconButton:{styleOverrides:{root:{minHeight:24,minWidth:24}}},MuiTooltip:{styleOverrides:{tooltip:{fontSize:12}}}},
  };
}
