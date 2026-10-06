import { FINANCIAL_FIELDS } from '../src/static/financialCurrent.js';
import {SCAN_FILTER_FIELDS} from '../src/static/scanClient.js';
// All global filter/sort values survive unchanged. Additional indicators and
// explanations belong to the on-demand detail, not every initial table row.
const fields=new Set([...SCAN_FILTER_FIELDS,...FINANCIAL_FIELDS,'name','product_name','quoteType','quote_type','cusip','isin','cik','issuer_cik','instrument_identity','instrument_applicability','financial_identity','financial_current','financial_generation','financial_evaluated_at','financial_knowledge_basis','financial_point_in_time','financial_source_publication_date','financial_policy_version','as_of_date','base_count_summary','eps_growth_quarterly','eps_growth_annual',...`adv_usd buy_risk_atr buy_risk_state composite_reason data_status exchange execution_cap_applied execution_cap_reason execution_state field_availability growth_metric_basis is_scannable market_themes pressure_state pressure_value price_sparkline_data price_trend rs_sparkline_data rs_trend se_rs_line_blue_dot se_pivot_price tpr_max tpr_score tpr_state chart_path research_detail_path market_regime market_above_50dma market_above_200dma institutional_sponsors_increasing`.split(' ')]);
export function scanListRow(row) {
  return Object.fromEntries(Object.entries(row).filter(([key])=>fields.has(key)));
}
