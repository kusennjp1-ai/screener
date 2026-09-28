import {describe,it,expect} from 'vitest';
import {scanListRow} from './scan-list-payload.mjs';
import {filterStaticScanRows,sortStaticScanRows} from '../src/static/scanClient.js';
describe('scan list projection',()=>{
  it('preserves nullable and numeric filter/sort fields exactly',()=>{
    const rows=[{symbol:'A',current_price:50,se_volume_vs_50d:1.499999,rs_rating:99,setup_engine:{heavy:'report'},financial_history:{annual:[]}},
      {symbol:'B',current_price:10,se_volume_vs_50d:null,rs_rating:70,book_technical_evidence:{heavy:'report'}}];
    const projected=rows.map(scanListRow);
    expect(projected[0].setup_engine).toBeUndefined();expect(projected[1].se_volume_vs_50d).toBeNull();
    for(const filters of [{},{price:{min:20}},{seVolumeVs50d:{min:1.5}},{rsRating:{min:80}}]) {
      expect(filterStaticScanRows(projected,filters).map(r=>r.symbol)).toEqual(filterStaticScanRows(rows,filters).map(r=>r.symbol));
    }
    expect(sortStaticScanRows(projected,'rs_rating','desc').map(r=>r.symbol)).toEqual(['A','B']);
  });
});
