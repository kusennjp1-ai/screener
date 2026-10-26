import './metricDisclosure.css';

// Native disclosure keeps the value/status available while explanations remain
// opt-in, with keyboard support and an expanded state supplied by the browser.
export default function MetricDisclosure({ summary, children, className = '' }) {
  return <details className={`metric-disclosure ${className}`}>
    <summary>{summary}<span className="metric-disclosure-chevron" aria-hidden="true">⌄</span></summary>
    <div className="metric-disclosure-body">{children}</div>
  </details>;
}
