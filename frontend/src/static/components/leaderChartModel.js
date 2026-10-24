import { transformToCandlestickData } from '../../components/Charts/candlestickData';
import { chartHistoryWarning, invalidChartHistory, dateKey } from '../../components/Charts/researchChartModel';
import { requireChartIdentity } from '../chartPayloadIdentity';

// Same preceding-window algorithm as CandlestickChart's research volume line:
// the current session is excluded, and incomplete windows are never filled.
export function precedingVolumeMean(volume, window = 50) {
  const result = []; let running = 0;
  for (let i = 0; i < volume.length; i++) {
    if (i >= window) result.push({ time: volume[i].time, value: running / window });
    running += volume[i].value;
    if (i >= window) running -= volume[i - window].value;
  }
  return result;
}
export function leaderChartModel({ bars, symbol, date, rsLine = [], timeframe = 'daily' }) {
  try { requireChartIdentity({ symbol, as_of_date: date, bars }, symbol, date); }
  catch (error) { return { error: error.message }; }
  if (!bars?.length) return { error: '日足データなし' };
  const error = invalidChartHistory(bars);
  if (error) return { error };
  const data = transformToCandlestickData(bars, timeframe, { includeEMA: false });
  const dates = new Set(data.candlesticks.map(point => point.time));
  const dailyDates = new Set(bars.map(bar => bar.date));
  // Do not interpolate, forward-fill, sort or normalize the supplied RS series.
  const rsValid = Array.isArray(rsLine) && rsLine.length > 0 && rsLine.every((point, index) =>
    Number.isFinite(point?.value) && point.value > 0 && dailyDates.has(dateKey(point.time)) &&
    (index === 0 || dateKey(point.time) > dateKey(rsLine[index - 1].time))) && dateKey(rsLine.at(-1).time) === date;
  return { ...data, volumeMean: precedingVolumeMean(data.volume, timeframe === 'weekly' ? 10 : 50),
    rs: rsValid ? rsLine.filter(point => dates.has(dateKey(point.time))).map(point => ({ time: dateKey(point.time), value: point.value })) : [],
    warning: chartHistoryWarning(bars), error: null };
}

// Pure geometry. Missing sessions split paths, never create an interpolated
// benchmark observation across a missing trading day.
export function seriesPaths(points, bars, x, y) {
  const map = new Map(points.map(point => [point.time, point.value]));
  const paths = []; let current = [];
  bars.forEach((bar, index) => {
    const value = map.get(bar.time);
    if (Number.isFinite(value)) current.push(`${x(index)},${y(value)}`);
    else if (current.length) { paths.push(current.join(' ')); current = []; }
  });
  if (current.length) paths.push(current.join(' '));
  return paths;
}
