// This runs in Node after profiling has ended. It derives supplementary fields
// from existing observations without adding browser work or changing a gate.
const metadata = {
  schema_version: 'continuous-switch-phase-summary-v1',
  acceptance_measurement: false,
  clock_source: 'browser_performance_now',
};

function phaseSummary(start, end, tasks) {
  const overlaps = tasks.map(task => [Math.max(start, task.start), Math.min(end, task.start + task.duration)])
    .filter(([left, right]) => right > left)
    .sort(([leftA], [leftB]) => leftA - leftB);
  const merged = [];
  for (const [left, right] of overlaps) {
    const previous = merged.at(-1);
    if (previous && left <= previous[1]) previous[1] = Math.max(previous[1], right);
    else merged.push([left, right]);
  }
  return {
    wall_ms: end - start,
    observed_long_task_overlap_count: overlaps.length,
    observed_long_task_union_ms: merged.reduce((sum, [left, right]) => sum + (right - left), 0),
    maximum_task_overlap_ms: overlaps.reduce((maximum, [left, right]) => Math.max(maximum, right - left), 0),
  };
}

export function summarizeContinuousSwitch(phases, observations) {
  const invalid = reason => ({ ...metadata, valid: false, reason, phases: null });
  const markers = [phases?.candidate_ready, phases?.click_dispatch, phases?.switch_endpoint];
  if (markers.some(marker => !Number.isFinite(marker?.now) || marker.now < 0 || !Number.isFinite(marker?.time_origin))) {
    return invalid('missing_or_invalid_marker');
  }
  const [ready, click, endpoint] = markers;
  if (markers.some(marker => marker.time_origin !== ready.time_origin) || observations?.time_origin !== ready.time_origin) {
    return invalid('different_or_missing_time_origin');
  }
  if (ready.now > click.now || click.now > endpoint.now) return invalid('non_monotonic_markers');
  const tasks = observations?.long_tasks;
  if (!Array.isArray(tasks)) return invalid('missing_long_task_observations');
  if (tasks.some(task => !Number.isFinite(task?.start) || task.start < 0 ||
    !Number.isFinite(task?.duration) || task.duration < 0 || !Number.isFinite(task.start + task.duration))) {
    return invalid('invalid_long_task_observation');
  }
  return {
    ...metadata,
    valid: true,
    reason: null,
    phases: {
      before_click_dispatch: phaseSummary(ready.now, click.now, tasks),
      after_click_dispatch: phaseSummary(click.now, endpoint.now, tasks),
    },
  };
}
