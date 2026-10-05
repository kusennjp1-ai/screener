import { open, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Only called after the three original acceptance measurements. A matching
// browser timeline distinguishes rendering/layout/paint from V8's opaque
// (program) samples; phase markers exclude profiler-start sampling gaps.
export async function recordProfileDiagnostic({ cdp, page, output, name, action, settleMs = 0 }) {
  const metadata = { name, acceptance_measurement: false, markers: {}, profile: `${name}.cpuprofile`, trace: `${name}.trace.json` };
  let profiling = false, tracing = false, traceStream;
  const mark = async phase => {
    metadata.markers[phase] = await page.evaluate(({ label, resetTasks }) => {
      if (resetTasks) window.__reviewTasks = [];
      performance.mark(label);
      return { label, time_origin: performance.timeOrigin, now: performance.now() };
    }, { label:`${name}:${phase}`, resetTasks:phase === 'start' });
  };
  try {
    await cdp.send('Profiler.enable');
    await cdp.send('Tracing.start', {
      categories: 'devtools.timeline,v8.execute,blink.user_timing,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.stack',
      transferMode: 'ReturnAsStream', streamFormat: 'json', streamCompression: 'none',
    });
    tracing = true;
    await cdp.send('Profiler.start'); profiling = true;
    await mark('start');
    await action();
    await mark('ready');
    if (settleMs) await page.waitForTimeout(settleMs);
    await mark('end');
    metadata.observations = await page.evaluate(() => ({
      time_origin: performance.timeOrigin, now: performance.now(),
      long_tasks: window.__reviewTasks || [],
      navigation: performance.getEntriesByType('navigation').map(entry => entry.toJSON()),
      resources: performance.getEntriesByType('resource').map(entry => ({ name: entry.name, initiatorType: entry.initiatorType, startTime: entry.startTime, duration: entry.duration, transferSize: entry.transferSize, decodedBodySize: entry.decodedBodySize })),
    }));
  } catch (error) {
    metadata.error = error.message;
  } finally {
    if (profiling) {
      try {
        const { profile } = await cdp.send('Profiler.stop');
        metadata.profile_clock = { start_us: profile.startTime, end_us: profile.endTime, first_sample_gap_us: profile.timeDeltas?.[0] ?? null };
        await writeFile(resolve(output, metadata.profile), JSON.stringify(profile));
      } catch (error) { metadata.profile_error = error.message; }
    }
    if (tracing) {
      let timeout, onComplete;
      try {
        const complete = new Promise(accept => {
          onComplete = event => { traceStream = event.stream; accept(event); };
          cdp.once('Tracing.tracingComplete', onComplete);
        });
        // Attach both rejection handlers immediately: trace completion can
        // precede a missing acknowledgement, and either can fail independently.
        const deadline = new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Trace completion timed out')), 15000); });
        const [, result] = await Promise.race([Promise.all([cdp.send('Tracing.end'), complete]), deadline]);
        clearTimeout(timeout);
        traceStream = result.stream;
        if (!traceStream) throw Error('Trace stream unavailable');
        metadata.trace_data_loss = Boolean(result.dataLossOccurred);
        const file = await open(resolve(output, metadata.trace), 'w');
        try {
          let bytes = 0;
          for (;;) {
            const chunk = await cdp.send('IO.read', { handle: traceStream, size: 1024 * 1024 });
            const buffer = Buffer.from(chunk.data, chunk.base64Encoded ? 'base64' : 'utf8');
            bytes += buffer.length;
            if (bytes > 64 * 1024 * 1024) throw Error('Diagnostic trace exceeded 64 MiB');
            await file.write(buffer);
            if (chunk.eof) break;
          }
          metadata.trace_bytes = bytes;
        } finally { await file.close(); }
      } catch (error) { metadata.trace_error = error.message; }
      finally {
        clearTimeout(timeout);
        if (onComplete) cdp.off('Tracing.tracingComplete', onComplete);
        if (traceStream) await cdp.send('IO.close', { handle: traceStream }).catch(() => {});
      }
    }
    await cdp.send('Profiler.disable').catch(() => {});
    await writeFile(resolve(output, `${name}.json`), JSON.stringify(metadata, null, 2));
  }
  if (metadata.error || metadata.profile_error || metadata.trace_error || metadata.trace_data_loss) {
    throw Error(`${name}: ${metadata.error || metadata.profile_error || metadata.trace_error || 'trace lost events'}`);
  }
  return metadata;
}
