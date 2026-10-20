import { expect, it } from 'vitest';
import { summarizeContinuousSwitch } from './continuous-switch-summary.mjs';

const phases = () => ({
  candidate_ready: { time_origin: 1000, now: 100 },
  click_dispatch: { time_origin: 1000, now: 200 },
  switch_endpoint: { time_origin: 1000, now: 300 },
});
const observations = long_tasks => ({ time_origin: 1000, long_tasks });

it('clips task boundaries, unions overlaps, and excludes work after the endpoint', () => {
  const input = {
    phases: phases(),
    observations: observations([
      { start: 280, duration: 60 }, // only the part before endpoint
      { start: 50, duration: 70 }, // only the part after ready
      { start: 180, duration: 50 }, // crosses click dispatch
      { start: 190, duration: 20 }, // nested; do not add its duration twice
      { start: 300, duration: 500 }, // diagnostic tail
      { start: 0, duration: 100 }, // ends exactly at ready
    ]),
  };
  const original = structuredClone(input);
  const result = summarizeContinuousSwitch(input.phases, input.observations);
  expect(result).toEqual({
    schema_version: 'continuous-switch-phase-summary-v1', acceptance_measurement: false,
    clock_source: 'browser_performance_now', valid: true, reason: null,
    phases: {
      before_click_dispatch: { wall_ms: 100, observed_long_task_overlap_count: 3, observed_long_task_union_ms: 40, maximum_task_overlap_ms: 20 },
      after_click_dispatch: { wall_ms: 100, observed_long_task_overlap_count: 3, observed_long_task_union_ms: 50, maximum_task_overlap_ms: 30 },
    },
  });
  expect(input).toEqual(original);
});

it('distinguishes an observed empty task list and zero-duration interval from missing evidence', () => {
  const values = phases(); values.click_dispatch.now = values.candidate_ready.now;
  const result = summarizeContinuousSwitch(values, observations([]));
  expect(result.valid).toBe(true);
  expect(result.phases.before_click_dispatch).toEqual({ wall_ms: 0, observed_long_task_overlap_count: 0, observed_long_task_union_ms: 0, maximum_task_overlap_ms: 0 });
  expect(result.phases.after_click_dispatch.wall_ms).toBe(200);
  expect(summarizeContinuousSwitch(values, { time_origin: 1000 })).toMatchObject({ valid: false, reason: 'missing_long_task_observations', phases: null });
});

it.each([
  ['missing marker', value => { delete value.phases.click_dispatch; }, 'missing_or_invalid_marker'],
  ['nonfinite marker', value => { value.phases.click_dispatch.now = NaN; }, 'missing_or_invalid_marker'],
  ['negative marker', value => { value.phases.candidate_ready.now = -1; }, 'missing_or_invalid_marker'],
  ['different document', value => { value.phases.click_dispatch.time_origin++; }, 'different_or_missing_time_origin'],
  ['different observation clock', value => { value.observations.time_origin++; }, 'different_or_missing_time_origin'],
  ['missing observation clock', value => { delete value.observations.time_origin; }, 'different_or_missing_time_origin'],
  ['reverse ready/click', value => { value.phases.candidate_ready.now = 250; }, 'non_monotonic_markers'],
  ['reverse click/endpoint', value => { value.phases.switch_endpoint.now = 150; }, 'non_monotonic_markers'],
  ['missing tasks', value => { delete value.observations.long_tasks; }, 'missing_long_task_observations'],
  ['invalid task collection', value => { value.observations.long_tasks = {}; }, 'missing_long_task_observations'],
  ['null task', value => { value.observations.long_tasks = [null]; }, 'invalid_long_task_observation'],
  ['nonfinite task', value => { value.observations.long_tasks[0].duration = Infinity; }, 'invalid_long_task_observation'],
  ['negative duration', value => { value.observations.long_tasks[0].duration = -1; }, 'invalid_long_task_observation'],
  ['negative start', value => { value.observations.long_tasks[0].start = -1; }, 'invalid_long_task_observation'],
  ['overflowed endpoint', value => { value.observations.long_tasks = [{ start: Number.MAX_VALUE, duration: Number.MAX_VALUE }]; }, 'invalid_long_task_observation'],
])('retains unknown for %s without throwing or manufacturing zero timings', (_name, change, reason) => {
  const value = { phases: phases(), observations: observations([{ start: 120, duration: 60 }]) };
  change(value);
  expect(summarizeContinuousSwitch(value.phases, value.observations)).toMatchObject({ acceptance_measurement: false, valid: false, reason, phases: null });
});

it.each([
  {
    name: 'fractional phase boundaries',
    phases: {
      candidate_ready: { time_origin: 1000, now: 100.25 },
      click_dispatch: { time_origin: 1000, now: 200.5 },
      switch_endpoint: { time_origin: 1000, now: 300.75 },
    },
    observations: observations([{ start: 50, duration: 100 }, { start: 180.5, duration: 60.25 }, { start: 290.5, duration: 60 }]),
    expected: {
      before_click_dispatch: { wall_ms: 100.25, observed_long_task_overlap_count: 2, observed_long_task_union_ms: 69.75, maximum_task_overlap_ms: 49.75 },
      after_click_dispatch: { wall_ms: 100.25, observed_long_task_overlap_count: 2, observed_long_task_union_ms: 50.5, maximum_task_overlap_ms: 40.25 },
    },
  },
  {
    name: 'nested tasks within a task spanning both phases',
    phases: phases(),
    observations: observations([{ start: 95, duration: 220 }, { start: 120, duration: 60 }, { start: 220, duration: 20 }]),
    expected: {
      before_click_dispatch: { wall_ms: 100, observed_long_task_overlap_count: 2, observed_long_task_union_ms: 100, maximum_task_overlap_ms: 100 },
      after_click_dispatch: { wall_ms: 100, observed_long_task_overlap_count: 2, observed_long_task_union_ms: 100, maximum_task_overlap_ms: 100 },
    },
  },
])('summarizes $name without changing raw values', entry => {
  const original = structuredClone(entry);
  const result = summarizeContinuousSwitch(entry.phases, entry.observations);
  expect(result.valid).toBe(true);
  for (const [name, expected] of Object.entries(entry.expected)) {
    for (const [key, value] of Object.entries(expected)) expect(result.phases[name][key]).toBeCloseTo(value, 6);
  }
  expect(entry).toEqual(original);
});
