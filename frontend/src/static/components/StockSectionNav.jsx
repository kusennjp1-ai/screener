const sections = [
  ['chart', 'チャート', 'チャート', 'M3 16l5-6 4 3 8-9M3 21h18'],
  ['setup', 'VCP', 'VCP', 'M2 5l5 14 5-11 4 8 4-6 2 2'],
  ['conditions', '条件', '購入条件', 'M8 6h13M8 12h13M8 18h13M2 6l1 1 2-3M2 12l1 1 2-3M2 18l1 1 2-3'],
  ['financial', '財務', '財務・機関', 'M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7'],
  ['evidence', '根拠', '判定根拠', 'M9 3h6l5 4v14H4V3h5M8 11h8M8 15h8'],
  ['notes', 'メモ', 'メモ', 'M4 20l1-6L16 3l5 5L10 19zM14 5l5 5'],
];

export default function StockSectionNav({ value, onChange }) {
  const active = value === 'book' ? 'evidence' : value;
  const move = (event, key) => {
    const index = sections.findIndex(section => section[0] === key);
    let target;
    if (event.key === 'ArrowRight') target = sections[(index + 1) % sections.length][0];
    if (event.key === 'ArrowLeft') target = sections[(index - 1 + sections.length) % sections.length][0];
    if (event.key === 'Home') target = sections[0][0];
    if (event.key === 'End') target = sections.at(-1)[0];
    if (target) { event.preventDefault(); onChange(target); document.getElementById(`detail-tab-${target}`)?.focus(); }
  };
  return <div id="research-detail-tabs" className="stock-section-nav" role="tablist" aria-label="銘柄の詳細情報">
    {sections.map(([key, label, accessibleLabel, path]) => <button type="button" role="tab" key={key} id={`detail-tab-${key}`} aria-label={accessibleLabel}
      aria-selected={active === key} aria-controls={`detail-panel-${key==='evidence'&&value==='book'?'book':key}`} tabIndex={active === key ? 0 : -1}
      onClick={() => onChange(key)} onKeyDown={event => move(event, key)}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d={path} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg><span>{label}</span>
    </button>)}
  </div>;
}
