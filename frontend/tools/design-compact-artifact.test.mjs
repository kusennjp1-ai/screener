// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(new URL('../../.github/workflows/design-acceptance.yml', import.meta.url), 'utf8');
const compact = workflow.split('      - name: Preserve compact Design review screenshots and report\n')[1];

describe('compact Design review artifact', () => {
  it('uploads only a successfully bounded staging directory, including failed measurement runs', () => {
    expect(compact).toBeDefined();
    expect(compact).toContain("        if: always() && steps.compact.outcome == 'success'\n");
    expect(compact).toContain('        uses: actions/upload-artifact@v4\n');
    expect(compact).toContain('          name: design-review-compact-${{ github.sha }}-${{ github.run_attempt }}\n');
    expect(compact).toContain('          path: ${{ runner.temp }}/design-review-compact/\n');
    expect(compact).toContain('          retention-days: 7\n');
    expect(compact).toContain('          if-no-files-found: warn\n');
    expect(compact).not.toMatch(/include-hidden-files|continue-on-error|\*\*/);
    const stage = workflow.split('      - name: Stage bounded compact Design evidence\n')[1].split('      - name: Preserve compact Design')[0];
    expect(stage).toContain('        id: compact\n');
    expect(stage).toContain('        if: always()\n');
    expect(stage).toContain('run: node frontend/tools/prepare-compact-design.mjs frontend/test-results/design-review "${{ runner.temp }}/design-review-compact"');
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
