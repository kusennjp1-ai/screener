// Shared design tokens for the static PWA decision surfaces (C90 · hallmark audit).
//
// Single source of truth for the semantic palette so the buy card, watchlist,
// and any future card read one system instead of each re-declaring hex values.
// Semantics (not raw colour names): up/good=green, caution=amber, down/bad=red.
export const C = {green:'var(--zone)',red:'var(--neg)',amber:'var(--ext)',blue:'var(--wait)',ink:'var(--text-2)',inkStrong:'var(--text)',grey:'var(--text-3)',track:'var(--line)',panel:'var(--panel)',dim:'var(--neutral)'};

export default C;
