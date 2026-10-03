import SetupRadar from '../src/static/components/SetupRadar';

export const RADAR_ATTRIBUTION_MODES = ['empty-root', 'prepared-frame', 'full-radar'];

// Counterfactual controls for attribution only. They must never replace the
// complete 207-point component in radar-benchmark.jsx or any acceptance result.
export function radarAttributionElement(mode, ranked, small) {
  if (mode === 'empty-root') return null;
  if (mode === 'full-radar') return <SetupRadar ranked={ranked} small={small} onSelect={() => {}} />;
  if (mode === 'prepared-frame') {
    // Obtain the exact current component's host element and HTML, rather than
    // duplicating its markup. Preparation deliberately occurs before timing in
    // this control. Rendering the host element does not run the class lifecycle,
    // so the frame has all labels/geometry but no painted points or observers.
    return new SetupRadar({ ranked, small, onSelect: () => {} }).render();
  }
  throw Error(`Unknown radar attribution mode: ${mode}`);
}
