// The completion event can arrive before the protocol acknowledgement. Bound
// both together, and consume late promise rejections after the deadline.
export function stopTracingWithDeadline(session, timeoutMs = 10000) {
  return new Promise(resolve => {
    let timer, settled = false, acknowledged = false, completed = false;
    const finish = (ok, error = null, timedOut = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      session.off('Tracing.tracingComplete', onComplete);
      resolve({ ok, error, timed_out: timedOut, end_acknowledged: acknowledged, completion_received: completed });
    };
    const onComplete = () => { if (!settled) { completed = true; if (acknowledged) finish(true); } };
    try {
      session.once('Tracing.tracingComplete', onComplete);
      timer = setTimeout(() => finish(false, `Trace stop timed out after ${timeoutMs}ms (acknowledgement ${acknowledged ? 'received' : 'pending'}; completion ${completed ? 'received' : 'pending'})`, true), timeoutMs);
      Promise.resolve().then(() => session.send('Tracing.end')).then(
        () => { if (!settled) { acknowledged = true; if (completed) finish(true); } },
        error => finish(false, `Tracing.end rejected: ${String(error)}`),
      );
    } catch (error) { finish(false, `Trace stop failed: ${String(error)}`); }
  });
}

export async function stoppedTraceArtifact(session, traceEvents, timeoutMs = 10000) {
  const stop = await stopTracingWithDeadline(session, timeoutMs);
  return { traceEvents: [...traceEvents], trace_stop: stop, partial: !stop.ok };
}
