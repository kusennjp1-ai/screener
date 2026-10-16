// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(new URL('../../.github/workflows/design-acceptance.yml', import.meta.url), 'utf8');
const compact = workflow.split('      - name: Preserve compact Design review screenshots and report\n')[1];

describe('compact Design review artifact', () => {
  it('retains only top-level reports and screenshots, including failed runs', () => {
    expect(compact).toBeDefined();
    expect(compact).toContain('        if: always()\n');
    expect(compact).toContain('        uses: actions/upload-artifact@v4\n');
    expect(compact).toContain('          name: design-review-compact-${{ github.sha }}-${{ github.run_attempt }}\n');
    const paths = compact.split('          path: |\n')[1].split('          retention-days:')[0]
      .trim().split('\n').map(line => line.trim());
    expect(paths).toEqual([
      'frontend/test-results/design-review/report.json',
      'frontend/test-results/design-review/summary.md',
      'frontend/test-results/design-review/financial-carry-evidence.json',
      'frontend/test-results/design-review/*.png',
    ]);
    expect(compact).toContain('          retention-days: 7\n');
    expect(compact).toContain('          if-no-files-found: warn\n');
    expect(compact).not.toMatch(/include-hidden-files|continue-on-error|\*\*/);
  });

  it('preserves the separate complete evidence artifact and its retention', () => {
    const full = workflow.split('      - name: Preserve all results even when a budget fails\n')[1]
      .split('      # Keep the normal review download')[0];
    expect(full).toBe(`        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: design-acceptance-\${{ github.sha }}
          path: |
            frontend/test-results/design-review/
            \${{ runner.temp }}/design-input-provenance.json
            \${{ runner.temp }}/verified-publication/retained-universe-report.json
            \${{ runner.temp }}/design-carry-evidence/
            \${{ runner.temp }}/design-carry-verifier-reports/
            \${{ runner.temp }}/design-carry-prepare.log
            \${{ runner.temp }}/design-transport.log
          retention-days: 14
`);
    expect(workflow.indexOf('      - name: Require reviewed screenshots and four design scores of at least 8.0'))
      .toBeLessThan(workflow.indexOf('      - name: Preserve compact Design review screenshots and report'));
  });
});
