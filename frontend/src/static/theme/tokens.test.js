import { createTheme } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { fonts, researchTheme } from './tokens';

describe('research typography over an already expanded app theme', () => {
  it.each(['dark', 'light'])('replaces inherited remote fonts in every MUI variant and portal for %s mode', mode => {
    const appTheme = createTheme({ typography: { fontFamily: '"Inter", sans-serif', subtitle1: { fontSize: 17 } } });
    const original = appTheme.typography.body1.fontFamily;
    const research = createTheme(appTheme, researchTheme(mode));
    // This is the actual StaticLayout composition path. Merely setting the
    // family on the second options object leaves expanded variants unchanged.
    for (const variant of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'subtitle1', 'subtitle2', 'body1', 'body2', 'button', 'caption', 'overline']) {
      expect(research.typography[variant].fontFamily).toBe(fonts.body);
    }
    expect(research.typography.subtitle1.fontSize).toBe(17);
    expect(research.typography.body1.fontSize).toBe(14);
    expect(research.typography.button.textTransform).toBe('none');
    expect(appTheme.typography.body1.fontFamily).toBe(original);
  });
});
