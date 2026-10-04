import { readFileSync } from 'node:fs';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import FinancialEvidenceSummary from './FinancialEvidenceSummary';

let style;
afterEach(()=>{cleanup();style?.remove();});
it('keeps the financial actions at 44px when the later foundation desktop control rule is present',()=>{
 style=document.createElement('style');
 style.textContent=readFileSync('src/static/components/financialEvidence.css','utf8')+'\n.leader-shell button { min-height:24px; }';
 document.head.append(style);
 render(<div className="leader-shell"><FinancialEvidenceSummary method="oneil" symbol="TEST" date="2026-10-02" generation="test" now={Date.parse('2026-10-03T12:00:00Z')} onNavigate={()=>{}}/></div>);
 for(const button of screen.getAllByRole('button'))expect(getComputedStyle(button).minHeight).toBe('44px');
});
