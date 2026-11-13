// Today's SEC coverage warning, from the brief's own function, on the block CI logged for the published 11-12 data.
import { readFileSync } from 'node:fs';
const [src, log] = process.argv.slice(2);
const { fundamentalsCoverageWarning, publishedFundamentalsCoverage } = await import(`${src}/frontend/src/static/fundamentalsExplain.js`);
const line = readFileSync(log, 'utf8').split('\n').find(l => l.includes('Published coverage (fundamentals):'));
const report = JSON.parse(line.slice(line.indexOf('{')));
const block = report.fundamentals_coverage;
const admitted = publishedFundamentalsCoverage({ as_of_date: block.as_of_date, fundamentals_coverage: block });
console.log('block warnings:', JSON.stringify(block.warnings), '| admitted by the brief:', Boolean(admitted));
console.log('Today warning:', JSON.stringify(fundamentalsCoverageWarning(admitted, { date: block.as_of_date })));
console.log('report warnings (CI only):', JSON.stringify(report.warnings));
console.log('listed sec_state:', JSON.stringify(report.coverage.sec_state));
const synthetic = { ...block, warnings: ['refused'] };
console.log('same block with one warning code:', JSON.stringify(fundamentalsCoverageWarning(synthetic, { date: block.as_of_date })));
