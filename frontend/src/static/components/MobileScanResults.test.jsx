import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import MobileScanResults from './MobileScanResults';
import ScreenSelector from './ScreenSelector';

const props = {rows:[{symbol:'AMD',company_name:'Synthetic long company name to preserve in its title',current_price:120,se_setup_ready:null}],total:43,page:2,perPage:20,sortBy:'rs_rating',sortOrder:'desc',onSort:vi.fn(),onPage:vi.fn(),onOpenChart:vi.fn(),isChartEnabled:()=>true};
it('preserves unknown readiness and full result counts across mobile pagination',()=>{
  renderWithProviders(<MobileScanResults {...props}/>);
  expect(screen.getByText('21–40 / 43件')).toBeInTheDocument();
  expect(screen.queryByText('通過')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'次へ'}));
  expect(props.onPage).toHaveBeenCalledWith(3);
  fireEvent.click(screen.getByRole('button',{name:'AMD の日次分析'}));
  expect(props.onOpenChart).toHaveBeenCalledWith('AMD');
  expect(screen.getByTitle(props.rows[0].company_name)).toBeInTheDocument();
});
it('disables zero-result presets without treating unavailable counts as zero',()=>{
  const onSelect=vi.fn();
  renderWithProviders(<ScreenSelector screens={[{id:'minervini',tier:1},{id:'vcp',tier:1}]} matchCounts={{minervini:0}} onSelectScreen={onSelect}/>);
  const zero=screen.getByRole('button',{name:'補助 ミネルヴィニ (0)'});
  expect(zero).toHaveAttribute('aria-disabled','true');
  expect(screen.getByRole('button',{name:'補助 VCP'})).not.toHaveAttribute('aria-disabled','true');
});
it('labels the technical setup default independently of the quarantined auxiliary score',()=>{
  renderWithProviders(<MobileScanResults {...props} sortBy="se_setup_score"/>);
  expect(screen.getByRole('combobox',{name:'詳細スキャンの並び順'})).toHaveTextContent('セットアップ点');
  expect(screen.getByRole('combobox',{name:'詳細スキャンの並び順'})).not.toHaveTextContent('補助スコア');
});
it('shows unavailable detector readiness as unknown and retains its reason',()=>{
  const reason='SPY benchmark unavailable; benchmark-dependent setup and RS remain unknown';
  renderWithProviders(<MobileScanResults {...props} rows={[{symbol:'AMD',se_setup_ready:false,setup_recalculation:{status:'unavailable',reason}}]}/>);
  const row=screen.getByTestId('mobile-scan-row');
  expect(row.querySelector('dl').lastElementChild).toHaveTextContent('準備条件未確認');
  expect(row).not.toHaveTextContent('未達');
  expect(row).toHaveTextContent(reason);
});
it.each([[true,'通過'],[false,'未達']])('preserves calculated readiness %j as %s',(ready,label)=>{
  renderWithProviders(<MobileScanResults {...props} rows={[{symbol:'AMD',se_setup_ready:ready,setup_recalculation:{status:'calculated'}}]}/>);
  expect(screen.getByTestId('mobile-scan-row').querySelector('dl').lastElementChild).toHaveTextContent(`準備条件${label}`);
});
