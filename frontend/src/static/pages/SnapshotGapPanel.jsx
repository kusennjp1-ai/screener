import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Paper, Typography } from '@mui/material';
import { C, T, W, px } from '../designTokens';

/**
 * 静的スナップショットに或るページのデータが入っていないときの空状態。
 *
 * これまでは `<Alert>{backendMessage}</Alert>` で、バックエンドの英語例外
 * （"No benchmark trading session is available for market US on 2026-07-24."）
 * をそのままユーザーに見せていた。生のバックエンド文字列は、言語を問わず
 * ユーザー向けの文言ではない。
 *
 * デイリータブの EmptySectionBar（StaticHomePage.jsx）と同じ質のバーを目指し、
 * 「なぜ無いのか」「スナップショットに何が入っているのか」「代わりに何ができるのか」
 * を 1 枚で答える。空ページの下に黒い余白だけが残る状態も、これで内容が埋める。
 *
 * このファイルは騰落・業種グループ・スキャンの各ページから使う共有部品で、
 * ページ側にコピーを増やさないために切り出している。
 */
export function SnapshotGapPanel({
  testId,
  title,
  statusLabel = 'データなし',
  reason,
  facts = [],
  factsTitle = 'このスナップショットの中身',
  actions = [],
  actionsTitle = 'いま代わりにできること',
  footnote,
  onAction,
}) {
  return (
    <Paper
      data-testid={testId}
      elevation={0}
      sx={{ border: `1px solid ${C.track}`, borderRadius: 1, overflow: 'hidden' }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          minHeight: 36,
          px: 1.25,
          py: 0.75,
          borderBottom: `1px solid ${C.track}`,
        }}
      >
        <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: C.amber, flexShrink: 0 }} />
        <Typography sx={{ fontSize: px(T.body), fontWeight: W.bold, color: C.inkStrong, lineHeight: 1.3 }}>
          {title}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: px(T.micro), fontFamily: 'monospace', color: C.amber, flexShrink: 0 }}>
          {statusLabel}
        </Typography>
      </Box>

      <Box sx={{ px: 1.25, py: 1.25 }}>
        <Typography sx={{ fontSize: px(T.body), color: C.ink, lineHeight: 1.8 }}>{reason}</Typography>

        {facts.length > 0 && (
          <Box sx={{ mt: 1.5 }}>
            <Typography sx={{ fontSize: px(T.micro), fontWeight: W.bold, color: C.grey, mb: 0.5 }}>
              {factsTitle}
            </Typography>
            {facts.map((fact) => (
              <Box
                key={fact.label}
                sx={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 1,
                  py: 0.4,
                  borderTop: `1px solid ${C.track}`,
                }}
              >
                <Typography sx={{ fontSize: px(T.micro), color: C.grey, minWidth: 92, flexShrink: 0 }}>
                  {fact.label}
                </Typography>
                <Typography
                  sx={{
                    fontSize: px(T.micro),
                    fontFamily: 'monospace',
                    color: fact.muted ? C.dim : C.ink,
                    lineHeight: 1.5,
                  }}
                >
                  {fact.value}
                </Typography>
              </Box>
            ))}
          </Box>
        )}

        {actions.length > 0 && (
          <Box sx={{ mt: 1.5 }}>
            <Typography sx={{ fontSize: px(T.micro), fontWeight: W.bold, color: C.grey, mb: 0.75 }}>
              {actionsTitle}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
              {actions.map((action) => (
                <Button
                  key={action.label}
                  component={action.to ? RouterLink : 'button'}
                  to={action.to}
                  type={action.to ? undefined : 'button'}
                  onClick={action.to ? undefined : () => onAction?.(action.id)}
                  size="small"
                  variant="outlined"
                  sx={{
                    fontSize: px(T.micro),
                    fontWeight: W.medium,
                    color: C.ink,
                    borderColor: C.track,
                    textTransform: 'none',
                    py: 0.4,
                    '&:hover': { borderColor: C.grey, backgroundColor: 'transparent' },
                  }}
                >
                  {action.label}
                </Button>
              ))}
            </Box>
          </Box>
        )}

        {footnote && (
          <Typography sx={{ fontSize: px(T.micro), color: C.dim, lineHeight: 1.7, mt: 1.5 }}>
            {footnote}
          </Typography>
        )}
      </Box>
    </Paper>
  );
}

/**
 * マニフェストの display_name はバックエンド由来の英語（"United States"）。
 * 日本語画面の見出しに英語の国名が出るのを避けるため、市場コードから
 * 日本語名に置き換える。未知のコードのときだけ元の表記に戻す。
 */
const MARKET_NAMES_JA = {
  US: '米国',
  HK: '香港',
  IN: 'インド',
  JP: '日本',
  KR: '韓国',
  TW: '台湾',
  CN: '中国',
  DE: 'ドイツ',
  CA: 'カナダ',
  SG: 'シンガポール',
  MY: 'マレーシア',
  AU: 'オーストラリア',
};

export function marketDisplayNameJa(marketEntry) {
  const code = String(marketEntry?.market || '').toUpperCase();
  return MARKET_NAMES_JA[code] || marketEntry?.display_name || code || '';
}

/**
 * マニフェストが実際に持っている値だけを並べた「中身」リスト。
 * 推測は載せない — 分からないものは行ごと出さない。
 */
export function buildSnapshotFacts(marketEntry) {
  const features = marketEntry?.features || {};
  const freshness = marketEntry?.freshness || {};
  const chartCount = marketEntry?.assets?.charts?.symbols_total;
  const facts = [];

  if (marketEntry?.as_of_date) {
    facts.push({ label: '基準日', value: marketEntry.as_of_date });
  }
  facts.push({
    label: '騰落',
    value: features.breadth ? (freshness.breadth_latest_date || '収録あり') : '収録なし',
    muted: !features.breadth,
  });
  facts.push({
    label: '業種グループ',
    value: features.groups ? (freshness.groups_latest_date || '収録あり') : '収録なし',
    muted: !features.groups,
  });
  facts.push({
    label: 'スキャン',
    value: features.scan && freshness.scan_as_of_date
      ? `${freshness.scan_as_of_date} 時点`
      : '収録なし',
    muted: !features.scan,
  });
  if (chartCount != null) {
    facts.push({ label: 'チャート', value: `${Number(chartCount).toLocaleString()} 銘柄` });
  }
  return facts;
}

export default SnapshotGapPanel;
