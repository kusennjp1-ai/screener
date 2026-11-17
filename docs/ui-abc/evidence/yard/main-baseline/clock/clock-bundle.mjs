// ../../../../../../../../../home/user/screener/.claude/worktrees/ui-plan/frontend/src/static/evidenceTime.js
var newYorkDayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});
var days = /* @__PURE__ */ new Map();
var CACHE_LIMIT = 4096;
function remember(cache, key, value) {
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, value);
  return value;
}
var validEvidenceDay = (value) => {
  if (typeof value !== "string" || value.length !== 10) return false;
  if (days.has(value)) return days.get(value);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  return remember(days, value, valid);
};

// ../../../../../../../../../home/user/screener/.claude/worktrees/ui-plan/frontend/src/static/marketLongHistory.js
var SECTOR_ETFS = ["XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY"];
var STAGES = ["stage1", "stage2", "stage3", "stage4"];
var ENVIRONMENT_COUNTS = ["trendTemplateCount", "rs90TemplateCount", "above150", "above200", ...STAGES, "breakouts"];
var BREAKOUT_MIN_SAMPLE = 5;
var LEADER_MIN_COHORT = 10;
var SPLIT_RULE = Object.freeze({ nearHighPercent: 5, above200Below: 50 });

// ../../../../../../../../../home/user/screener/.claude/worktrees/ui-plan/frontend/src/static/marketUpdateState.js
var LONG_HISTORY_ENVIRONMENT_KEYS = ["trendTemplateCount", "rs90TemplateCount", "above200", "above200Percent", "stage1", "stage2", "stage3", "stage4"];
var LEGACY_LONG_HISTORY_REASON = "\u74B0\u5883\u6307\u6A19\uFF08TT\u30FB\u30B9\u30C6\u30FC\u30B8\u7B49\uFF09\u3092\u542B\u307E\u306A\u3044\u65E7\u5F62\u5F0F\u306E\u9577\u671F\u96C6\u8A08";
function marketUpdateState(data, now = Date.now()) {
  const schedule = data?.refresh_schedule, sessions = schedule?.sessions;
  const until = Date.parse(schedule?.valid_until);
  const valid = Number.isFinite(now) && schedule?.provider === "pandas_market_calendars:NYSE" && Number.isFinite(until) && now < until && Array.isArray(sessions) && sessions.length > 0 && sessions.every((row, i) => validEvidenceDay(row?.date) && Number.isFinite(Date.parse(row.close_at)) && Date.parse(row.close_at) < until && (!i || row.date > sessions[i - 1].date && Date.parse(row.close_at) > Date.parse(sessions[i - 1].close_at)));
  const target = valid ? sessions.filter((row) => Date.parse(row.close_at) <= now).at(-1)?.date : null;
  const daily = validEvidenceDay(data?.as_of_date) ? data.as_of_date : null;
  const history = validEvidenceDay(data?.long_history?.as_of_date) ? data.long_history.as_of_date : null;
  if (!target || daily > target || history > target) return { state: "unknown", target: null, daily, history, reason: null };
  const long = data?.long_history, breadth = long?.breadth?.at(-1), index = long?.sp500?.at(-1), sectors = long?.sectorRotation?.frames?.at(-1);
  const actual = breadth?.date === target && breadth.coverage >= 100 && breadth.eligibleUniverse >= breadth.coverage && breadth.coverage / breadth.eligibleUniverse >= 0.9 && ["above50Percent", "newHighs", "newLows", "leaderCount"].every((key) => Number.isFinite(breadth[key]) && breadth[key] >= 0) && breadth.above50Percent <= 100 && index?.date === target && Number.isFinite(index.close) && index.close > 0 && sectors?.date === target && Array.isArray(sectors.ranks) && sectors.ranks.length === 11 && new Set(sectors.ranks.map((row) => row.symbol)).size === 11 && sectors.ranks.every((row) => SECTOR_ETFS.includes(row.symbol) && Number.isInteger(row.rank) && row.rank === 1 + sectors.ranks.filter((other) => other.relativeIndex > row.relativeIndex).length && Number.isFinite(row.relativeIndex) && row.relativeIndex > 0);
  const legacy = breadth !== null && typeof breadth === "object" && !LONG_HISTORY_ENVIRONMENT_KEYS.every((key) => Object.hasOwn(breadth, key));
  return { state: daily === target && history === target && actual && !legacy ? "current" : "pending", target, daily, history, reason: legacy ? LEGACY_LONG_HISTORY_REASON : null };
}

// ../../../../../../../../../home/user/screener/.claude/worktrees/ui-plan/frontend/src/static/reference/indexSummary.js
var finite = Number.isFinite;

// ../../../../../../../../../home/user/screener/.claude/worktrees/ui-plan/frontend/contracts/native_annual_history_v1.json
var native_annual_history_v1_default = {
  schema_version: "native-annual-history-policy-v1",
  policy_id: "financial-correction-native-annual-v1",
  history_schema: "provider-reported-native-annual-eps-v1",
  source_policy_id: "financial-correction-explicit-ownership-v1",
  provider_metric: "annualDilutedEPS",
  basis: "reported_diluted_eps",
  unit: "reporting_currency_per_provider_share",
  share_basis: "provider_reported_split_adr_unverified",
  supported_currencies: [
    "USD",
    "ARS",
    "BRL",
    "CAD",
    "CHF",
    "CNY",
    "COP",
    "DKK",
    "EUR",
    "GBP",
    "HKD",
    "INR",
    "JPY",
    "KRW",
    "KZT",
    "MXN",
    "PEN",
    "TWD"
  ],
  source_max_age_hours: 72,
  latest_period_max_age_days: 550,
  period_gap_days: [
    345,
    385
  ],
  limitations: [
    "Provider-reported share units and split/ADR restatement are not independently verified; this limitation also applies to accepted USD annual histories.",
    "A singleton currency set establishes agreement of recorded codes, not a currency code independently verified on every cell.",
    "No FX conversion, valuation use, basic EPS substitution, quarterly reconstruction or historical knowledge claim."
  ]
};

// ../../../../../../../../../home/user/screener/.claude/worktrees/ui-plan/frontend/src/static/financialHistory.js
var NATIVE_ANNUAL_SCHEMA = native_annual_history_v1_default.history_schema;

// ../../../../../../../../../home/user/screener/.claude/worktrees/ui-plan/frontend/contracts/financial_instrument_applicability_v1.json
var financial_instrument_applicability_v1_default = {
  schema_version: "financial-instrument-applicability-v1",
  verified_at: "2026-10-04T12:50:56Z",
  purpose: "Reviewed applicability observations; not an instrument-to-price or instrument-to-statement identity binding",
  records: [
    {
      market: "US",
      symbol: "BITU",
      name: "ProShares Ultra Bitcoin ETF",
      instrument_class: "exchange_traded_fund",
      cusip: "74349Y704",
      source: "https://www.proshares.com/our-etfs/leveraged-and-inverse/BITU",
      source_owner: "ProShares",
      source_kind: "official_fund_page",
      corporate_growth_screen_applicability: "not_applicable",
      identity_match_limit: "Published row has matching ticker and product name, but no instrument identifier; recorded official CUSIP is not yet bound to price or financial receipts."
    },
    {
      market: "US",
      symbol: "SBIT",
      name: "ProShares UltraShort Bitcoin ETF",
      instrument_class: "exchange_traded_fund",
      cusip: "74349Y563",
      source: "https://www.proshares.com/our-etfs/leveraged-and-inverse/sbit",
      source_owner: "ProShares",
      source_kind: "official_fund_page",
      corporate_growth_screen_applicability: "not_applicable",
      identity_match_limit: "Published row has matching ticker and product name, but no instrument identifier; recorded official CUSIP is not yet bound to price or financial receipts."
    },
    {
      market: "US",
      symbol: "ETHE",
      name: "Grayscale Ethereum Staking ETF",
      instrument_class: "exchange_traded_product",
      cik: "0001725210",
      cusip: "389638107",
      isin: "US3896381072",
      source: "https://www.sec.gov/Archives/edgar/data/1725210/000172521026000003/ethe_fact_sheet_4.23.26.htm",
      source_owner: "Grayscale",
      source_kind: "issuer_fact_sheet_filed_with_SEC",
      document_date: "2026-04-23",
      document_data_as_of: "2026-03-31",
      corporate_growth_screen_applicability: "not_applicable",
      identity_match_limit: "Published row has matching ticker and product name, but no instrument identifier. This filing establishes product identity and type, not October financial freshness or price-series identity."
    }
  ],
  limitations: [
    "These three official observations do not classify any other symbol or name match.",
    "Not-applicable is not a passed EPS, sales or annual-growth condition.",
    "No recorded identifier is bound to price series or statement receipts by this registry.",
    "Conflicting current or legacy issuer evidence requires quarantine and explicit review before historical data are joined."
  ]
};

// ../../../../../../../../../home/user/screener/.claude/worktrees/ui-plan/frontend/src/static/instrumentApplicability.js
var INSTRUMENT_APPLICABILITY_VERSION = financial_instrument_applicability_v1_default.schema_version;
var INSTRUMENT_IDENTITY_FIELDS = Object.freeze(["symbol", "market", "company_name", "name", "product_name", "cusip", "isin", "cik", "issuer_cik", "quoteType", "quote_type", "financial_identity", "instrument_identity"]);
var records = new Map(financial_instrument_applicability_v1_default.records.map((record) => [record.symbol, record]));

// ../../../../../../../../../home/user/screener/.claude/worktrees/ui-plan/frontend/contracts/static_financial_current_v1.json
var static_financial_current_v1_default = {
  schema: "static-financial-current-v2",
  version: 2,
  field_order: [
    "eps_growth_qq",
    "eps_growth_yy",
    "sales_growth_qq",
    "sales_growth_yy",
    "annual_eps_growth_3y",
    "eps_5yr_cagr",
    "eps_q1_yoy",
    "eps_q2_yoy",
    "eps_raw_score",
    "revenue_growth",
    "profit_margin",
    "roe",
    "eps_rating",
    "smr_rating",
    "composite_rating",
    "composite_rating_score"
  ],
  aliases: {
    eps_growth_quarterly: "eps_growth_qq",
    eps_growth_annual: "eps_growth_yy"
  },
  summary_keys: [
    "v",
    "t",
    "s",
    "m",
    "a",
    "r",
    "p"
  ],
  proof_tuple: [
    "value",
    "contract_id",
    "metric",
    "periods_newest_first",
    "observed_at_ms",
    "expires_at_ms",
    "comparison_code",
    "calculation_code"
  ],
  reason_codes: {
    "0": "available",
    "1": "missing_or_invalid_value",
    "2": "missing_evidence",
    "3": "invalid_envelope",
    "4": "identity_mismatch",
    "5": "value_mismatch",
    "6": "future_source_timestamp",
    "7": "stale_source",
    "8": "unsupported_contract",
    "9": "invalid_reporting_period",
    a: "stale_reporting_period",
    b: "unverified_derivation_and_cohort",
    c: "invalid_evaluation_context",
    d: "alias_conflict",
    e: "invalid_source_inputs",
    f: "nonpositive_comparison_base"
  },
  source_max_age_ms: 6048e5,
  quarter_max_age_days: 190,
  annual_max_age_days: 550,
  year_gap_days: [
    345,
    385
  ],
  expiry_boundary: "available while now <= expires_at_ms; period expiry is final millisecond of latest-period plus max-age UTC day",
  contracts: {
    "0": {
      fields: [
        "eps_growth_qq",
        "sales_growth_qq"
      ],
      source: "yfinance",
      producer: "yfinance.quarterly_income_stmt/transport-capture-v1",
      basis: "quarterly_qoq/v1",
      unit: "percent_points",
      cadence: "quarterly",
      quarter_gap_days: [
        70,
        130
      ],
      period_count: [
        2,
        2
      ],
      comparison: "quarter_over_quarter"
    },
    "1": {
      fields: [
        "eps_growth_yy",
        "sales_growth_yy"
      ],
      source: "yfinance",
      producer: "yfinance.quarterly_income_stmt/transport-capture-v1",
      basis: "comparable_period_yoy/v1",
      unit: "percent_points",
      cadence: "quarterly",
      quarter_gap_days: [
        70,
        130
      ],
      period_count: [
        5,
        5
      ],
      comparison: "quarter_year_over_year"
    },
    "2": {
      fields: [
        "eps_q1_yoy",
        "eps_q2_yoy"
      ],
      source: "yfinance",
      producer: "yfinance.quarterly_income_stmt/transport-capture-v1",
      basis: "quarterly_eps_yoy/v1",
      unit: "percent_points",
      cadence: "quarterly",
      quarter_gap_days: [
        70,
        110
      ],
      period_count: [
        5,
        5
      ],
      comparison: "quarter_year_over_year"
    },
    "3": {
      fields: [
        "eps_5yr_cagr"
      ],
      source: "yfinance",
      producer: "yfinance.income_stmt/transport-capture-v1",
      basis: "annual_eps_cagr/v1",
      unit: "percent_points",
      cadence: "annual",
      period_count: [
        2,
        5
      ],
      comparison: "positive_annual_eps_cagr"
    }
  },
  metrics: {
    eps: [
      "Diluted EPS",
      "Basic EPS"
    ],
    sales: [
      "Total Revenue",
      "Operating Revenue"
    ]
  },
  trust_boundary: "Python validates observation and capture digests and concrete source semantics. Browser validates this versioned summary, exact value/identity/as-of binding and expiry; it must not recompute Python JSON digests. For reason f only, an explicit null ordinary-growth scalar retains the certified tuple value as a reference; absent or conflicting scalars never qualify. Summary is not a portable cryptographic signature. Missing, old, malformed or mismatched summaries never grant availability.",
  proof_reason_codes: [
    "0",
    "f"
  ],
  comparison_codes: {
    g: "profitable_growth",
    d: "profitable_decline",
    u: "profitable_unchanged",
    n: "new_loss",
    z: "profit_to_zero",
    l: "loss_narrowing",
    w: "loss_widening",
    s: "loss_unchanged",
    t: "turnaround",
    b: "break_even",
    "0": "undefined_base",
    G: "growth",
    D: "decline",
    U: "unchanged",
    X: "nonpositive_base"
  },
  calculation_codes: {
    r: "rounded_percent_change",
    c: "clipped_percent_change",
    a: "rounded_positive_cagr",
    k: "clipped_positive_cagr"
  },
  comparison_policy: "Classifications bind validated captured source cells, never inferred EPS signs from a percentage. A nonpositive comparison base cannot supply ordinary growth; reason f retains a source-valid reference proof while the projected scalar stays unknown. Zero-base division and annual heuristics remain unsupported. Basic/Diluted metric, periods and percent-point units are explicit; full original inputs stay in detail evidence."
};

// ../../../../../../../../../home/user/screener/.claude/worktrees/ui-plan/frontend/src/static/financialCurrent.js
var FINANCIAL_FIELDS = Object.freeze(static_financial_current_v1_default.field_order);
var FINANCIAL_CURRENT_VERSION = static_financial_current_v1_default.schema;
var FINANCIAL_DEPENDENT_FIELDS = Object.freeze([
  "composite_score",
  "composite_reason",
  "minervini_score",
  "canslim_score",
  "ipo_score",
  "custom_score",
  "minervini_rating",
  "minervini_passes",
  "canslim_rating",
  "canslim_passes",
  "ipo_rating",
  "ipo_passes",
  "custom_rating",
  "custom_passes",
  "rating",
  "rating_explanation",
  "code33",
  "rating_basis_score",
  "rating_basis_screener",
  "fundamental_bonus",
  "fundamental_bonus_detail",
  "screeners_passed",
  "passed_screeners",
  "passes_count",
  "screeners_passed_count"
]);
var quarantined = /* @__PURE__ */ new Set(["eps_raw_score", ...FINANCIAL_FIELDS.slice(12)]);
var protectedFields = [...FINANCIAL_FIELDS, ...Object.keys(static_financial_current_v1_default.aliases), ...FINANCIAL_DEPENDENT_FIELDS];

// ../../../../../../../../../home/user/screener/.claude/worktrees/ui-plan/frontend/src/static/financialPublicationExceptionPolicy.js
var FINANCIAL_PUBLICATION_EXCEPTION = Object.freeze({
  version: "five-symbol-financial-unknown-v1",
  symbols: Object.freeze(["NVDA", "FUTU", "AAOI", "ALH", "AVT"]),
  label: "\u8CA1\u52D9\u672A\u78BA\u8A8D\u30FB\u5224\u5B9A\u5BFE\u8C61\u5916"
});

// ../../../../../../../../../home/user/screener/.claude/worktrees/ui-plan/frontend/src/static/financialPublicationException.js
var symbols = new Set(FINANCIAL_PUBLICATION_EXCEPTION.symbols);

// ../../../../../../../../../home/user/screener/.claude/worktrees/ui-plan/frontend/src/static/institutionalIdentityEvents.js
var institutionalIdentityEvents = Object.freeze([
  {
    symbol: "CCL",
    effectiveDate: "2026-05-07",
    previousCusip: "143658300",
    currentCusip: "G2004J103",
    reason: "2026-05-07\u306E\u6CD5\u4EBA\u7D71\u5408\u30FBCUSIP\u5909\u66F4\u3092\u307E\u305F\u3050\u305F\u3081\u3001\u65E7\u30FB\u65B0\u8B58\u5225\u5B50\u306E\u5831\u544A\u4F1A\u793E\u6570\u3092\u76F4\u63A5\u6BD4\u8F03\u3067\u304D\u307E\u305B\u3093",
    source: "https://www.sec.gov/Archives/edgar/data/876661/000087666126000397/ruleprovisionnotice.htm"
  }
]);

// ../../../../../../../../../home/user/screener/.claude/worktrees/ui-plan/frontend/src/static/bookSourceContext.js
var PIVOT_FOLLOW_SOURCE_TITLE = "\u682A\u5F0F\u30C8\u30EC\u30FC\u30C9 \u57FA\u672C\u3068\u539F\u5247";
var pivotSource = `\u300E${PIVOT_FOLLOW_SOURCE_TITLE}\u300FPDF 245\u9801`;

// ../../../../../../../../../home/user/screener/.claude/worktrees/ui-plan/frontend/src/static/researchEngine.js
var finite2 = (v) => typeof v === "number" && Number.isFinite(v);

// ../../../../../../../../../home/user/screener/.claude/worktrees/ui-plan/frontend/src/static/positionGeometry.js
var isNumber = Number.isFinite;
var moneyFormatter = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ../../../../../../../../../home/user/screener/.claude/worktrees/ui-plan/frontend/src/static/bookFinancialAdmission.js
var SEC_UNAVAILABLE_REASONS = Object.freeze(["no_cik", "no_companyfacts", "no_quarterly", "transient", "invalid_payload"]);
var SEC_FORMS = Object.freeze(["10-K", "10-Q", "10-K/A", "10-Q/A"]);
var SEC_FIELD_TAGS = Object.freeze({ "eps": [["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted"], "USD/shares"], "revenue": [["RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "Revenues", "SalesRevenueNet"], "USD"], "netIncome": [["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"], "USD"], "inventory": [["InventoryNet"], "USD"], "receivables": [["AccountsReceivableNetCurrent", "AccountsNotesAndOtherReceivablesNetCurrent"], "USD"] });
var QUARTERLY_FIELDS = Object.keys(SEC_FIELD_TAGS);
var DERIVATION_GAP_REASONS = Object.freeze(["tag_mismatch", "broken_chain", "no_annual"]);
var SEC_REFUSAL_REASONS = Object.freeze(["schema", "symbol", "as_of", "retrieved_window", "keys", "cik_url", ...QUARTERLY_FIELDS.map((field) => `series:${field}`), "series:annualEps", "not_corporate"]);
var SEC_PUBLICATION_REFUSAL_REASONS = Object.freeze([...SEC_REFUSAL_REASONS, "projection"]);

// ../../../../../../../../../home/user/screener/.claude/worktrees/ui-plan/frontend/src/static/fundamentalsExplain.js
var finite3 = (value) => typeof value === "number" && Number.isFinite(value);
function wholePercent(value) {
  if (!finite3(value)) return null;
  const whole = Math.sign(value) * Math.round(Math.abs(value));
  return whole === 0 ? 0 : whole;
}
var COVERAGE_WARNINGS = Object.freeze(["truncated", "deadline_unreached", "ticker_map_unavailable", "file_schema", "refused", "no_quarters"]);
var EARNINGS_CHIP_PERCENT = 25;
var meetsEarningsChipPercent = (value) => {
  const whole = wholePercent(value);
  return whole !== null && whole >= EARNINGS_CHIP_PERCENT;
};
var EARNINGS_CHIP_NOTE = `\u696D\u7E3E\u30C1\u30C3\u30D7\uFF1AEPS\u30FB\u58F2\u4E0A\u306E\u524D\u5E74\u540C\u671F\u6BD4\u304C\u3068\u3082\u306B${EARNINGS_CHIP_PERCENT}%\u4EE5\u4E0A\u3067\u7DD1\uFF08\u72EC\u81EA\u8A2D\u5B9A\uFF09\u3002`;
var CHIP_TITLE = `\u524D\u5E74\u540C\u671F\u6BD4\uFF08SEC XBRL\u30FB\u72EC\u81EA\u8A2D\u5B9A\uFF1AEPS\u30FB\u58F2\u4E0A\u3068\u3082${EARNINGS_CHIP_PERCENT}%\u4EE5\u4E0A\u3067\u7DD1\uFF09`;

// ../../../../../../../../../home/user/screener/.claude/worktrees/ui-plan/frontend/src/static/brief/briefShared.js
var isoDay = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
function shortDate(iso, reference) {
  if (!isoDay(iso)) return "\u65E5\u4ED8\u672A\u78BA\u8A8D";
  const [y, m, d] = iso.split("-").map(Number);
  return `${isoDay(reference) && reference.slice(0, 4) !== iso.slice(0, 4) ? `${y}/` : ""}${m}/${d}`;
}

// ../../../../../../../../../home/user/screener/.claude/worktrees/ui-plan/frontend/src/static/brief/briefCandidate.js
var BREAKOUT_VOLUME_RATIO = 1.4;
var positive = (value) => finite2(value) && value > 0;
var BASE_DEPTH_MAX_PERCENT = 35;
var BASE_LENGTH_MIN_WEEKS = 3;
var EXTENDED_FROM_SMA50_PERCENT = 25;
var BASE_CAUTION_NOTE = `\u571F\u53F0\u306E\u6CE8\u610F\uFF1ASetup Engine\u306E\u571F\u53F0\u304C\u6DF1\u3055${BASE_DEPTH_MAX_PERCENT}%\u8D85\u307E\u305F\u306F${BASE_LENGTH_MIN_WEEKS}\u9031\u672A\u6E80\u3001\u307E\u305F\u306F\u7D42\u5024\u304C50\u65E5\u7DDA\u3088\u308A${EXTENDED_FROM_SMA50_PERCENT}%\u8D85\u4E0A\uFF08\u72EC\u81EA\u5224\u5B9A\uFF09\u3002`;
var EPS_YOY_FILTER_PERCENT = EARNINGS_CHIP_PERCENT;
var SE_CONFIDENCE_FLOOR = 55;
var BASE_UNCHECKED_CHIP = "\u571F\u53F0\u672A\u78BA\u8A8D";
var BASE_UNCHECKED_NOTE = `${BASE_UNCHECKED_CHIP}\uFF1ASetup Engine\u306E\u571F\u53F0\u304C\u5206\u6790\u65E5\u306E\u3082\u306E\u3067\u306A\u3044\u304B\u3001\u4FE1\u983C\u5EA6\u304C${SE_CONFIDENCE_FLOOR}\u672A\u6E80\u307E\u305F\u306F\u672A\u78BA\u8A8D\u306E\u305F\u3081\u3001\u30D4\u30DC\u30C3\u30C8\u306F\u53C2\u8003\uFF08\u7070\u8272\u306E\u884C\u30FB\u72EC\u81EA\u5224\u5B9A\uFF09\u3002`;
var baseMuted = (view) => view?.baseCurrent === false && (view.position === "zone" || view.position === "near");
var cents = (value) => Math.round(value * 100);
var ratioShown = (value) => `${(Math.floor(value * 100 + 1e-9) / 100).toFixed(2)}\xD7`;
var AFTER_EVENT = Object.freeze({ kind: "after", tone: "zone", title: "\u8CB7\u3044\u30BE\u30FC\u30F3\u5185\uFF08\u4E0A\u629C\u3051\u5F8C\uFF09" });
var UNDATED_EVENT = Object.freeze({ kind: "undated", tone: "wait", title: "\u8CB7\u3044\u30BE\u30FC\u30F3\u5185\uFF08\u4E0A\u629C\u3051\u65E5 \u672A\u78BA\u8A8D\uFF09", note: "\u4E0A\u629C\u3051\u306E\u65E5\u3092\u691C\u8A3C\u6E08\u307F\u306E\u65E5\u8DB3\u3067\u78BA\u8A8D\u3067\u304D\u306A\u3044\u305F\u3081\u3001\u8CB7\u3044\u306E\u88CF\u4ED8\u3051\u306F\u3042\u308A\u307E\u305B\u3093\u3002" });
function breakoutEvent(view, { touched = false } = {}) {
  if (view?.state !== "zone" || !isoDay(view.asOf) || !positive(view.pivot) || !positive(view.close) || !positive(view.prevClose) || !finite2(view.change)) return null;
  const pivot = cents(view.pivot), close = cents(view.close), before = cents(view.prevClose), change = view.change;
  const volume = finite2(view.volumeRatio) ? view.volumeRatio : null, heavy = volume !== null && volume >= BREAKOUT_VOLUME_RATIO, day = shortDate(view.asOf);
  if (change < 0 && heavy) return { kind: "heavyDown", tone: "ext", title: `${day} \u4E0B\u843D\u65E5\u306E\u5927\u5546\u3044 ${ratioShown(volume)}\uFF08\u8981\u6CE8\u610F\uFF09` };
  if (before < pivot && close === pivot) return { kind: "touch", tone: "zone", title: `${day}\u306B\u30D4\u30DC\u30C3\u30C8\u5230\u9054` };
  if (before === pivot && close === pivot) return { kind: "touchHeld", tone: "wait", title: "\u30D4\u30DC\u30C3\u30C8\u3068\u540C\u5024\u306E\u307E\u307E", note: "\u30D4\u30DC\u30C3\u30C8\u306B\u5C4A\u3044\u305F\u65E5\u3092\u691C\u8A3C\u6E08\u307F\u306E\u65E5\u8DB3\u3067\u78BA\u8A8D\u3067\u304D\u306A\u3044\u305F\u3081\u3001\u8CB7\u3044\u306E\u88CF\u4ED8\u3051\u306F\u3042\u308A\u307E\u305B\u3093\u3002" };
  if ((before < pivot || touched === true && before === pivot) && close > pivot) {
    if (change > 0 && heavy) return { kind: "breakout", tone: "zone", title: `${day}\u306B\u4E0A\u629C\u3051\u30FB\u51FA\u6765\u9AD8${ratioShown(volume)}` };
    return {
      kind: "cross",
      tone: "wait",
      title: volume === null ? `${day}\u306B\u4E0A\u629C\u3051\u30FB\u51FA\u6765\u9AD8 \u672A\u78BA\u8A8D` : `${day}\u306B\u4E0A\u629C\u3051\u30FB\u51FA\u6765\u9AD8\u4E0D\u8DB3`,
      note: volume === null ? "\u51FA\u6765\u9AD8\u3092\u78BA\u8A8D\u3067\u304D\u306A\u3044\u305F\u3081\u3001\u4E0A\u629C\u3051\u306E\u88CF\u4ED8\u3051\u306F\u3042\u308A\u307E\u305B\u3093\u3002" : `\u51FA\u6765\u9AD8${ratioShown(volume)}\u306F\u57FA\u6E96\u306E${BREAKOUT_VOLUME_RATIO}\xD7\u306B\u5C4A\u304D\u307E\u305B\u3093\u3002`
    };
  }
  if (before === pivot && close > pivot) return { ...UNDATED_EVENT };
  if (before > pivot) return { ...AFTER_EVENT };
  return null;
}
var dayEvent = (view) => view?.event === void 0 ? breakoutEvent(view) : view.event;
var inZone = (view) => view.state === "zone";
var nearPivot = (view) => view.state === "wait" && finite2(view.distance) && view.distance >= -5;
var LIST_FILTERS = {
  zone: { label: "\u8CB7\u3044\u30BE\u30FC\u30F3", test: (view) => view.qualified && inZone(view) },
  near: { label: "\u30D4\u30DC\u30C3\u30C8\u63A5\u8FD1", test: (view) => view.qualified && nearPivot(view) },
  all: { label: "\u9078\u5B9A\u3059\u3079\u3066", test: (view) => view.qualified },
  one: { label: "\u3042\u30681\u6761\u4EF6", test: (view) => !view.qualified && view.failed === 1 && view.unknown === 0 },
  // Today's focus pool (the zone and near filters together). Hidden: never a segment button.
  focus: { label: "\u6CE8\u76EE\u5019\u88DC", hidden: true, test: (view) => view.qualified && (inZone(view) || nearPivot(view)) },
  // The analysis day's breakouts among the selected stocks (Today's 「うち上抜けN」 and the 条件 menu). Hidden. A
  // selected stock in the zone whose day is not verified (no event), whose close above the pivot follows one at its
  // cents (breakoutEvent's 'undated': the rows cannot tell the day's breakout from a rise after an earlier one), or
  // whose breakout is of a pivot that is only a reference (baseMuted: the conclusion reads 土台を確認できない), is counted
  // apart (`unknown`), never as a miss. `why` ends in a noun: the list says 「…のため判定していません」 after it.
  breakout: {
    label: "\u4E0A\u629C\u3051",
    hidden: true,
    test: (view) => view.qualified && dayEvent(view)?.kind === "breakout" && !baseMuted(view),
    unknown: (view) => view.qualified && inZone(view) && (!dayEvent(view) || dayEvent(view).kind === "undated" || dayEvent(view).kind === "breakout" && baseMuted(view)),
    why: "\u5206\u6790\u57FA\u6E96\u65E5\u306E\u5024\u52D5\u304D\u304C\u672A\u691C\u8A3C\u304B\u3001\u4E0A\u629C\u3051\u306E\u65E5\u304C\u672A\u78BA\u8A8D\u304B\u3001Setup Engine\u306E\u571F\u53F0\u304C\u672A\u78BA\u8A8D"
  },
  // The selected stocks whose latest SEC EPS change is EPS_YOY_FILTER_PERCENT or more; a stock whose SEC summary
  // is missing, not dated for the analysis date or without the value is counted apart (`unknown`), never as a miss.
  // `field`: the published row field it reads (absent from older publications: 未収録).
  eps: {
    label: `EPS\u524D\u5E74\u6BD4\u2265${EPS_YOY_FILTER_PERCENT}%\uFF08\u76F4\u8FD1\u30FBSEC\uFF09`,
    short: `EPS\u524D\u5E74\u6BD4\u2265${EPS_YOY_FILTER_PERCENT}%`,
    hidden: true,
    field: "sec_summary",
    // Compared as the chip prints it (meetsEarningsChipPercent: 24.6 reads +25%), so a row reading 「EPS +25%」 is in it.
    test: (view) => view.qualified && meetsEarningsChipPercent(view.epsYoy),
    unknown: (view) => view.qualified && !finite2(view.epsYoy),
    why: "SEC\u306EEPS\u524D\u5E74\u6BD4\u304C\u672A\u78BA\u8A8D"
  }
};

// ../../../../../../../../../home/user/screener/.claude/worktrees/ui-plan/frontend/src/static/brief/pivotBar.js
var PIVOT_TIMEFRAMES = Object.freeze({
  "cup_with_handle": "weekly",
  // backend/app/analysis/patterns/cup_handle.py:209
  "three_weeks_tight": "weekly",
  // backend/app/analysis/patterns/three_weeks_tight.py:133
  "high_tight_flag": "daily",
  // backend/app/analysis/patterns/high_tight_flag.py:176
  "first_pullback": "daily",
  // backend/app/analysis/patterns/first_pullback.py:161
  "vcp": "daily",
  // backend/app/analysis/patterns/vcp_wrapper.py:89
  "nr7_inside_day": "daily"
  // backend/app/analysis/patterns/nr7_inside_day.py:214
});

// ../../../../../../../../../home/user/screener/.claude/worktrees/ui-plan/frontend/src/static/brief/breakoutHistory.js
var STALE_BREAKOUT_SESSIONS = 10;

// ../../../../../../../../../home/user/screener/.claude/worktrees/ui-plan/frontend/src/static/brief/briefSell.js
var SELL_RULES = {
  recentSessions: 5,
  advanceMinPercent: 30,
  advanceMinSessions: 20,
  upDaysWindow: 10,
  upDaysMin: 8,
  climaxPercent: 25,
  climaxSessions: 15,
  breakVolumeRatio: BREAKOUT_VOLUME_RATIO,
  // The strength (climax) checks judge only a stock that is extended: beyond the buy zone and at least
  // this far above its pivot (独自判定, shown on screen). Below it a breakout's own big day is a buy point.
  climaxFromPivotPercent: 20,
  // …or, whatever the pivot (real rows lose a pivot more than 25% away), a certified close at least this far
  // above its 50-day line (独自判定). Not a finite positive number: the alternative is off.
  climaxFrom50dPercent: 25,
  // A stock still in the buy zone this many sessions after its dated crossing has not advanced (独自判定). Read when
  // asked, not when this module loads, so a test that mocks breakoutHistory with only the export it needs can load it.
  get staleBreakoutSessions() {
    return STALE_BREAKOUT_SESSIONS;
  },
  // A crossing on breakVolumeRatio or more followed, within this many sessions, by a close back under the
  // pivot is a failed breakout (ブレイク失敗, 独自判定).
  failedBreakoutSessions: 10
};

// ../../../../../../../../../home/user/screener/.claude/worktrees/ui-plan/frontend/src/static/priceActivity.js
var NONE = Object.freeze({ range60pct: null, lowRange: false, reason: null, adr20pct: null, gap: null });

// ../../../../../../../../../home/user/screener/.claude/worktrees/ui-plan/frontend/src/static/brief/buyGate.js
var PLAN_BLOCKED = Object.freeze({
  ext: "\u8CB7\u3044\u30BE\u30FC\u30F3\u8D85\u904E\uFF1A\u65B0\u898F\u306E\u8A66\u7B97\u306F\u3057\u307E\u305B\u3093\uFF08\u6B21\u306E\u571F\u53F0\u3092\u5F85\u3064\uFF09",
  low: "\u4F4E\u5909\u52D5\u30FB\u76E3\u8996\u306E\u307F\uFF1A\u65B0\u898F\u306E\u8A66\u7B97\u306F\u3057\u307E\u305B\u3093",
  acq: "\u8CB7\u53CE\u5408\u610F\u30FB\u5BFE\u8C61\u5916\uFF1A\u65B0\u898F\u306E\u8A66\u7B97\u306F\u3057\u307E\u305B\u3093",
  na: "\u5224\u5B9A\u4E0D\u53EF\uFF1A\u65B0\u898F\u306E\u8A66\u7B97\u306F\u3057\u307E\u305B\u3093\uFF08\u6709\u52B9\u306A\u8CB7\u3044\u6C34\u6E96\u304C\u672A\u78BA\u8A8D\uFF09"
});
var HEAVY_DOWN_NOTE = `\u3053\u306E\u305F\u3081\u65B0\u898F\u306E\u8CB7\u3044\u306F\u898B\u9001\u308A\u307E\u3059\uFF08\u51FA\u6765\u9AD8${ratioShown(SELL_RULES.breakVolumeRatio)}\u4EE5\u4E0A\u306E\u4E0B\u843D\u65E5\u30FB\u72EC\u81EA\u5224\u5B9A\uFF09\u3002`;

// ../../../../../../../../../home/user/screener/.claude/worktrees/ui-plan/frontend/src/static/bookTechnicalEvidence.js
var VCP_LOOKBACK = 150;
var ATR_SESSIONS = 20;
var ATR_MULTIPLE = 1.5;
var DEPTH_FRACTION = 0.3;
var FINAL_FLOOR_PCT = 1.5;
var MAX_LEGS = 6;
var REPAIR_FRACTION = 0.5;
var VCP_METHOD = Object.freeze({ lookback: VCP_LOOKBACK, atrSessions: ATR_SESSIONS, atrMultiple: ATR_MULTIPLE, depthFraction: DEPTH_FRACTION, finalFloorPct: FINAL_FLOOR_PCT, maxLegs: MAX_LEGS, repairFraction: REPAIR_FRACTION });

// ../../../../../../../../../home/user/screener/.claude/worktrees/ui-plan/frontend/src/static/brief/positionSizing.js
var STOP_DEFAULT_PERCENT = 7;
var STOP_MAX_PERCENT = 10;
var STOP_LIMIT_PERCENT = STOP_MAX_PERCENT - 0.5;
var POSITION_CAP_DEFAULT_PERCENT = 25;
var PLAN_DEFAULTS = Object.freeze({ stopPercent: STOP_DEFAULT_PERCENT, account: 5e4, riskPercent: 1.25, capPercent: POSITION_CAP_DEFAULT_PERCENT });

// ../../../../../../../../../home/user/screener/.claude/worktrees/ui-plan/frontend/src/static/brief/briefEnvironment.js
var ENV_RULES = Object.freeze({ templateSessions: 10, templateMinBase: 20, templateDropPercent: 20, leaderHealthBelow: 50, breakoutHoldBelow: 40 });
var NASDAQ_CAUTION_STATES = Object.freeze(["correction", "rally_attempt", "attempt_expired", "ftd_failed"]);
var MARKET_TILE_SUFFIX = Object.freeze({ ftd: "FTD\u78BA\u8A8D\u6E08\u307F", nasdaq: "NAS\u8ABF\u6574\u4E2D", rally: (day) => `\u53CD\u767A${day}\u65E5\u76EE` });
var INDEX_WORDS = Object.freeze({ "^GSPC": "S&P 500", "^IXIC": "Nasdaq\u7DCF\u5408" });
var FTD_TEXT = Object.freeze({ minDay: 4, maxDay: 15, gain: "+1.2%", decline: "6%" });

// ../../../../../../../../../home/user/screener/.claude/worktrees/ui-plan/frontend/src/static/brief/marketTabOnly.js
var finite4 = Number.isFinite;

// ../../../../../../../../../home/user/screener/.claude/worktrees/ui-plan/frontend/src/static/brief/marketTabModel.js
var finite5 = Number.isFinite;
var DISTRIBUTION_REFERENCE = 5;
var DISTRIBUTION_CAUTION = 7;
var DISTRIBUTION_TEXT = Object.freeze({ caution: `${DISTRIBUTION_CAUTION}\u65E5\u4EE5\u4E0A`, reference: `${DISTRIBUTION_REFERENCE}\u301C${DISTRIBUTION_CAUTION - 1}\u65E5` });
var REFERENCE_CHECKS = Object.freeze(["split", "lows", "template", "stage", "leaders", "breakout"]);
var STAGE_NAMES = ["\u5E95\u56FA\u3081", "\u4E0A\u6607", "\u5929\u4E95\u570F", "\u4E0B\u964D"];
var BREAKOUT_WINDOW_TEXT = "10\u301C29\u55B6\u696D\u65E5\u524D";
var RULE_TEXT = Object.freeze({
  ftd: `${FTD_TEXT.decline}\u4EE5\u4E0A\u306E\u4E0B\u843D\uFF08\u9AD8\u5024\u306E\u7D42\u5024\u304B\u3089\u5B89\u5024\u65E5\u306E\u7D42\u5024\u307E\u3067\uFF09\u306E\u5F8C\u3001\u53CD\u767A${FTD_TEXT.minDay}\u301C${FTD_TEXT.maxDay}\u65E5\u76EE\u306B\u51FA\u6765\u9AD8\u5897\u3092\u4F34\u3046${FTD_TEXT.gain}\u4EE5\u4E0A\u306E\u4E0A\u6607\u3002\u78BA\u8A8D\u5F8C\u306BFTD\u5F53\u65E5\u306E\u5B89\u5024\u3092\u7D42\u5024\u3067\u4E0B\u56DE\u308B\u3068\u5931\u6557\u3067\u3001\u6CE8\u610F\u30B5\u30A4\u30F3\u3067\u3059\u3002`,
  dist: `\u6307\u6570\u304C\u524D\u65E5\u6BD40.2%\u3092\u8D85\u3048\u3066\u4E0B\u843D\u3057\u3001\u51FA\u6765\u9AD8\u304C\u524D\u65E5\u3088\u308A\u591A\u304B\u3063\u305F\u65E5\u300225\u55B6\u696D\u65E5\u3067\u5931\u52B9\u3057\u3001\u305D\u306E\u5F8C\u306E\u9AD8\u5024\u304C\u5206\u914D\u65E5\u306E\u7D42\u5024\u304B\u30895%\u4EE5\u4E0A\u4E0A\u304C\u3063\u3066\u3082\u9664\u5916\u3057\u307E\u3059\u3002\u9664\u5916\u306E\u57FA\u6E96\u306F\u8CC7\u6599\u306B\u3088\u308A5%\uFF0F6%\u3067\u3001\u5F53\u30A2\u30D7\u30EA\u306F\u5F8C\u65E5\u306E\u9AD8\u5024\u30675%\u3067\u3059\uFF08\u72EC\u81EA\u9078\u629E\uFF09\u3002${DISTRIBUTION_TEXT.caution}\u3067\u6CE8\u610F\u30B5\u30A4\u30F3\u3001${DISTRIBUTION_TEXT.reference}\u306F\u53C2\u8003\u3067\u3059\uFF08\u72EC\u81EA\u8A2D\u5B9A\uFF09\u3002`,
  above200: `\u7D42\u5024\u304C200\u65E5\u7DDA\u3088\u308A\u4E0A\u306E\u9298\u67C4\u306E\u5272\u5408\uFF08\u89B3\u6E2C\u3067\u304D\u305F\u9298\u67C4\u306E\u3046\u3061\uFF09\u3002S&P 500\u304C1\u5E74\u9AD8\u5024\u304B\u3089${SPLIT_RULE.nearHighPercent}%\u4EE5\u5185\u306A\u306E\u306B${SPLIT_RULE.above200Below}%\u672A\u6E80\u306E\u3068\u304D\u300C\u6307\u6570\u3068\u500B\u5225\u682A\u306E\u4E56\u96E2\u300D\u3067\u6CE8\u610F\u30B5\u30A4\u30F3\u3067\u3059\u3002`,
  above50: "\u7D42\u5024\u304C50\u65E5\u7DDA\u3088\u308A\u4E0A\u306E\u9298\u67C4\u306E\u5272\u5408\uFF08\u89B3\u6E2C\u3067\u304D\u305F\u9298\u67C4\u306E\u3046\u3061\uFF09\u3002\u6CE8\u610F\u30B5\u30A4\u30F3\u306E\u57FA\u6E96\u306F\u3042\u308A\u307E\u305B\u3093\u3002",
  extremes: "52\u9031\u306E\u9AD8\u5024\u30FB\u5B89\u5024\u3092\u66F4\u65B0\u3057\u305F\u9298\u67C4\u6570\u3002\u65B0\u5B89\u5024\u304C\u65B0\u9AD8\u5024\u3092\u4E0A\u56DE\u308B\u3068\u6CE8\u610F\u30B5\u30A4\u30F3\u3067\u3059\u3002",
  template: `\u30DF\u30CD\u30EB\u30F4\u30A3\u30CB\u306E\u30C8\u30EC\u30F3\u30C9\u30C6\u30F3\u30D7\u30EC\u30FC\u30C88\u6761\u4EF6\uFF08RS\u63A8\u8A0870\u4EE5\u4E0A\u3092\u542B\u3080\uFF09\u3092\u3059\u3079\u3066\u6E80\u305F\u3059\u9298\u67C4\u6570\u3002${ENV_RULES.templateSessions}\u55B6\u696D\u65E5\u3067${ENV_RULES.templateDropPercent}%\u4EE5\u4E0A\u6E1B\u308B\u3068\u6CE8\u610F\u30B5\u30A4\u30F3\u3067\u3059\uFF08${ENV_RULES.templateSessions}\u55B6\u696D\u65E5\u524D\u304C${ENV_RULES.templateMinBase}\u9298\u67C4\u4EE5\u4E0A\u306E\u3068\u304D\uFF09\u3002`,
  leaderCount: "\u682A\u4FA1\u6761\u4EF6\u306E\u30C8\u30EC\u30F3\u30C9\u30C6\u30F3\u30D7\u30EC\u30FC\u30C8\uFF08\u5B89\u5024\u6761\u4EF625%\uFF09\u3068RS\u63A8\u8A0870\u4EE5\u4E0A\u3092\u6E80\u305F\u3059\u9298\u67C4\u6570\u3002TT\u9054\u6210\u6570\u306E\u65E7\u96C6\u8A08\u3067\u3001\u6CE8\u610F\u30B5\u30A4\u30F3\u306E\u57FA\u6E96\u306F\u3042\u308A\u307E\u305B\u3093\u3002",
  rs90: "TT\u9054\u6210\u9298\u67C4\u306E\u3046\u3061RS\u63A8\u8A08\uFF08\u72EC\u81EA\u8A08\u7B97\uFF09\u304C90\u4EE5\u4E0A\u306E\u9298\u67C4\u6570\u3002IBD\u306E\u516C\u5F0FRS\u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002\u6CE8\u610F\u30B5\u30A4\u30F3\u306E\u57FA\u6E96\u306F\u3042\u308A\u307E\u305B\u3093\u3002",
  breakout: `\u4FA1\u683C\u6761\u4EF6\u3092\u6E80\u305F\u3057\u3001\u7D42\u5024\u3067\u904E\u53BB251\u55B6\u696D\u65E5\u306E\u9AD8\u5024\u3092\u8D85\u3048\u3001\u51FA\u6765\u9AD8\u304C\u76F4\u524D50\u65E5\u5E73\u5747\u306E1.4\u500D\u4EE5\u4E0A\u3060\u3063\u305F\u4E0A\u629C\u3051\uFF08${BREAKOUT_WINDOW_TEXT}\uFF09\u306E\u3046\u3061\u3001\u305D\u306E\u5F8C10\u55B6\u696D\u65E5\u306E\u5B89\u5024\u304C\u4E0A\u629C\u3051\u65E5\u306E\u7D42\u5024\u304B\u3089\u22127%\u306B\u5C4A\u304B\u306A\u304B\u3063\u305F\u5272\u5408\u3002${BREAKOUT_MIN_SAMPLE}\u4EF6\u672A\u6E80\u306F\u7387\u3092\u51FA\u3057\u307E\u305B\u3093\u3002${ENV_RULES.breakoutHoldBelow}%\u672A\u6E80\u3067\u6CE8\u610F\u30B5\u30A4\u30F3\u3067\u3059\u3002`,
  leaders: `20\u55B6\u696D\u65E5\u524D\u306ETT\u9054\u6210\u9298\u67C4\u306E\u3046\u3061\u3001\u7D42\u5024\u304C50\u65E5\u7DDA\u306E\u4E0A\u306B\u3042\u308B\u5272\u5408\uFF08${LEADER_MIN_COHORT}\u9298\u67C4\u672A\u6E80\u306F\u7387\u3092\u51FA\u3057\u307E\u305B\u3093\uFF09\u3002${ENV_RULES.leaderHealthBelow}%\u672A\u6E80\u3067\u6CE8\u610F\u30B5\u30A4\u30F3\u3067\u3059\u3002`,
  stage: `200\u65E5\u7DDA\u306E\u50BE\u304D\u30FB\u682A\u4FA1\u306E\u50BE\u304D\u30FB200\u65E5\u7DDA\u3068\u306E\u4F4D\u7F6E\u304B\u3089\u65E5\u3054\u3068\u306B\u5224\u5B9A\u3057\u305F\u3001${STAGE_NAMES.map((name, i) => `${i + 1} ${name}`).join("\u30FB")}\u306E\u5272\u5408\u3002\u30B9\u30C6\u30FC\u30B84\u304C\u30B9\u30C6\u30FC\u30B82\u3092\u4E0A\u56DE\u308B\u3068\u6CE8\u610F\u30B5\u30A4\u30F3\u3067\u3059\u3002`
});
function verdictWaiting({ market, date, target }) {
  if (!(market?.cap > 0) || market.state === "unknown" || !isoDay(target) || !isoDay(date) || !(date < target)) return null;
  const md = shortDate(date, date);
  return { lead: `${md}\u5F15\u3051\u6642\u70B9\u306E\u5224\u5B9A\u3067\u3059\u3002\u65B0\u3057\u3044\u516C\u958B\u3092\u5F85\u3063\u3066\u3044\u307E\u3059\uFF08\u8CB7\u3044\u306E\u691C\u8A0E\u306F\u6700\u65B0\u306E\u5224\u5B9A\u3067\uFF09`, short: `${md}\u6642\u70B9\u306E\u5224\u5B9A\u30FB\u66F4\u65B0\u5F85\u3061` };
}

// ../../../../../../../../../home/user/screener/.claude/worktrees/ui-plan/frontend/src/static/brief/briefFreshness.js
var FRESHNESS_GRACE_HOURS = 28;
var HOUR = 36e5;
function validSessions(schedule, now) {
  const sessions = schedule?.sessions, until = Date.parse(schedule?.valid_until);
  const valid = Number.isFinite(now) && schedule?.provider === "pandas_market_calendars:NYSE" && Number.isFinite(until) && now < until && Array.isArray(sessions) && sessions.length > 0 && sessions.every((row, i) => validEvidenceDay(row?.date) && Number.isFinite(Date.parse(row.close_at)) && Date.parse(row.close_at) < until && (!i || row.date > sessions[i - 1].date && Date.parse(row.close_at) > Date.parse(sessions[i - 1].close_at)));
  return valid ? sessions : null;
}
function freshness({ trends, date, now } = {}) {
  const loading = Boolean(trends?.loading || trends?.isLoading) && !trends?.data;
  if (loading) return { state: "loading", missing: [], next: null };
  const asset = trends && Object.hasOwn(trends, "data") ? trends.data : trends;
  const sessions = validEvidenceDay(date) ? validSessions(asset?.refresh_schedule, now) : null;
  if (!sessions || !sessions.some((row) => row.date === date)) return { state: "unknown", missing: [], next: null };
  const after = sessions.filter((row) => row.date > date), closed = after.filter((row) => Date.parse(row.close_at) <= now);
  const upcoming = after.find((row) => Date.parse(row.close_at) > now);
  const deadline = closed.length ? Date.parse(closed[0].close_at) + FRESHNESS_GRACE_HOURS * HOUR : null;
  const missing = closed.map((row) => row.date);
  const nextClose = upcoming ? Date.parse(upcoming.close_at) : null;
  if (!closed.length) return { state: "current", missing, next: nextClose };
  if (now < deadline) return { state: "pending", missing, next: Math.min(deadline, nextClose ?? Infinity) };
  return { state: "stale", missing, next: nextClose };
}
function missingDays(missing, reference) {
  if (!missing?.length) return "";
  const day = (iso) => shortDate(iso, reference);
  return missing.length <= 2 ? missing.map(day).join("\u30FB") : `${day(missing[0])}\u301C${day(missing.at(-1))}`;
}
function freshnessLine(value, date) {
  if (value?.state === "unknown") return { tone: "unknown", age: "\u9BAE\u5EA6\u672A\u78BA\u8A8D", detail: "", note: `\u3053\u306E\u516C\u958B\uFF08${shortDate(date, date)}\u5F15\u3051\uFF09\u3088\u308A\u5F8C\u306E\u53D6\u5F15\u65E5\u3092\u3001\u53D6\u5F15\u6240\u30AB\u30EC\u30F3\u30C0\u30FC\u3067\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093\uFF08\u9BAE\u5EA6\u672A\u78BA\u8A8D\uFF09\u3002` };
  if (value?.state !== "stale") return null;
  const days2 = missingDays(value.missing, date);
  return {
    tone: "warn",
    age: `${value.missing.length}\u55B6\u696D\u65E5\u524D`,
    detail: `\uFF08${days2} \u672A\u53CD\u6620\uFF09`,
    note: `\u3053\u306E\u516C\u958B\u306F${shortDate(date, date)}\u5F15\u3051\u306E\u5206\u6790\u3067\u3059\u3002\u305D\u306E\u5F8C\u306B\u53D6\u5F15\u3092\u7D42\u3048\u305F${days2}\uFF08${value.missing.length}\u55B6\u696D\u65E5\uFF09\u306E\u5024\u306F\u307E\u3060\u53CD\u6620\u3055\u308C\u3066\u3044\u307E\u305B\u3093\uFF08\u516C\u958B\u306E\u9045\u308C\uFF1A\u53D6\u5F15\u7D42\u4E86\u304B\u3089${FRESHNESS_GRACE_HOURS}\u6642\u9593\u3092\u904E\u304E\u3066\u3082\u6B21\u306E\u516C\u958B\u304C\u306A\u3044\u3068\u304D\u306B\u8868\u793A\u30FB\u72EC\u81EA\u8A2D\u5B9A\uFF09\u3002`
  };
}

// ../../../../../../../../../home/user/screener/.claude/worktrees/ui-plan/frontend/src/static/portfolioPlan.js
var MARKET_CAPS = Object.freeze({ confirmed_uptrend: 0.5, uptrend_under_pressure: 0.25, otherwise: 0 });
var capText = (cap) => cap > 0 ? `\u6700\u5927${Math.round(cap * 100)}%` : "0%";
function modelMarket(rows) {
  const us = rows.filter((r) => r.market === "US" && r.currency === "USD");
  const regimes = [...new Set(us.map((r) => r.market_regime).filter(Boolean))];
  const observed = us.filter((r) => r.market_regime && typeof r.market_above_50dma === "boolean" && typeof r.market_above_200dma === "boolean");
  const regime = regimes.length === 1 ? regimes[0] : null;
  if (!observed.length || regimes.length !== 1) return { label: "\u5E02\u5834\u672A\u78BA\u8A8D", cap: 0, state: "unknown", regime, ftdUpgraded: false };
  const below200 = observed.some((r) => r.market_above_200dma === false), below50 = observed.some((r) => r.market_above_50dma === false);
  const known = { regime, ftdUpgraded: regime === "confirmed_uptrend" && (below200 || below50) };
  if (below200) return { label: "\u9577\u671F\u30C8\u30EC\u30F3\u30C9\u8B66\u6212\uFF08\u72EC\u81EA\u5224\u5B9A\uFF09", cap: MARKET_CAPS.otherwise, ...known };
  if (below50) return { label: "50\u65E5\u7DDA\u5272\u308C\uFF08\u5F31\u542B\u307F\u30FB\u72EC\u81EA\u5224\u5B9A\uFF09", cap: MARKET_CAPS.otherwise, ...known };
  if (observed.some((r) => r.market_above_50dma !== true)) return { label: "\u5E02\u5834\u6761\u4EF6\u672A\u78BA\u8A8D", cap: 0, state: "unknown", ...known };
  if (regime === "confirmed_uptrend") return { label: "\u4E0A\u6607\u30C8\u30EC\u30F3\u30C9\uFF08\u72EC\u81EA\u5224\u5B9A\uFF09", cap: MARKET_CAPS.confirmed_uptrend, ...known };
  if (regime === "uptrend_under_pressure") return { label: "\u4E0A\u6607\u306B\u5727\u529B\uFF08\u72EC\u81EA\u5224\u5B9A\uFF09", cap: MARKET_CAPS.uptrend_under_pressure, ...known };
  return { label: "\u65B0\u898F\u8CFC\u5165\u3092\u6291\u5236\uFF08\u72EC\u81EA\u5224\u5B9A\uFF09", cap: MARKET_CAPS.otherwise, ...known };
}
export {
  capText,
  freshness,
  freshnessLine,
  marketUpdateState,
  modelMarket,
  verdictWaiting
};
