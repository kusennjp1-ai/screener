import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { prepareResearchBundle } from './researchPreprocess.js';
import { createResearchReceiver } from './researchWorkerPackets.js';

vi.mock('./researchPreprocess.js', () => ({ prepareResearchBundle: vi.fn() }));

let messages;
beforeEach(async () => {
  vi.resetModules();
  messages = [];
  vi.stubGlobal('self', { postMessage: message => messages.push(structuredClone(message)) });
  await import('./researchWorker.js');
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

async function receivePublication() {
  const receive = createResearchReceiver();
  let result, delivered = 0;
  while (!result) {
    // There is exactly one unconsumed packet, including the terminal packet.
    expect(messages).toHaveLength(delivered + 1);
    expect(messages[delivered]).not.toHaveProperty('error');
    result = receive(messages[delivered++].packet);
    if (!result) await self.onmessage({ data: { operation: 'next-packet' } });
  }
  return result;
}

it('only advances the research stream after acknowledgement and preserves all row references', async () => {
  const rows = Array.from({ length: 701 }, (_, index) => ({
    symbol: `S${index}`, precise: index / 7, missing: undefined, unknown: null,
    entry_evidence: { calendar: { valid_until: '2026-10-01T00:00:00Z' } },
  }));
  const bundle = { rows, date: '2026-09-30',
    rankings: Object.fromEntries(['minervini', 'minervini2', 'oneil', 'ibd'].map(method => [method,
      [...rows].reverse().map(row => ({ row, assessment: { qualified: false, score: 0, unknown: 2 } })),
    ])), prepared: { market: { cap: 0 }, candidates: [rows[620]], primary: 0, strict: 0 } };
  prepareResearchBundle.mockReturnValue(bundle);
  await self.onmessage({ data: { operation: 'prepare', payloads: [{ rows }], date: bundle.date } });
  expect(messages).toHaveLength(1);
  expect(messages[0].packet.rows).toHaveLength(150);
  const result = await receivePublication();
  expect(result).toEqual(bundle);
  expect(result.rankings.minervini[0].row).toBe(result.rows[700]);
  expect(result.rankings.ibd[0].row).toBe(result.rows[700]);
  expect(result.prepared.candidates[0]).toBe(result.rows[620]);
  expect(result.rows[0]).toHaveProperty('missing', undefined);
  expect(messages.at(-1).packet.kind).toBe('complete');
});

it('applies the same backpressure to full workbench details without dropping metadata or changes', async () => {
  const items = Array.from({ length: 701 }, (_, index) => ({ symbol: `S${index}`, state: 'incomparable', changes: [], precise: index / 7 }));
  const workbench = { as_of: '2026-09-30', snapshot_id: 'publication-one', history: { previous_as_of: null },
    changes: { minervini: { counts: { incomparable: 701 }, items }, ibd: { counts: { incomparable: 701 }, items } } };
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => JSON.stringify(workbench) })));
  await self.onmessage({ data: { operation: 'workbench', url: 'https://example.test/workbench.json' } });
  expect(messages).toHaveLength(1);
  expect(messages[0].packet.kind).toBe('workbench-start');
  expect(await receivePublication()).toEqual(workbench);
});

it('reports a deferred generator failure rather than continuing a partial publication', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => JSON.stringify({ changes: { ibd: { items: null } } }) })));
  await self.onmessage({ data: { operation: 'workbench', url: 'https://example.test/workbench.json' } });
  expect(messages).toHaveLength(1);
  await self.onmessage({ data: { operation: 'next-packet' } });
  expect(messages[1]).toEqual({ error: 'Invalid workbench change records' });
});

it('reports an oversized ranking assessment after row acknowledgement without sending completion',async()=>{
 const row={symbol:'S'},bundle={rows:[row],rankings:{minervini:[{row,assessment:{reason:'x'.repeat(65536)}}]},prepared:{candidates:[row]}};
 prepareResearchBundle.mockReturnValue(bundle);
 await self.onmessage({data:{operation:'prepare',payloads:[{rows:[row]}]}});
 expect(messages).toHaveLength(1);
 expect(messages[0].packet.kind).toBe('rows');
 await self.onmessage({data:{operation:'next-packet'}});
 expect(messages).toHaveLength(2);
 expect(messages[1]).toEqual({error:'Oversized research ranking item'});
});
