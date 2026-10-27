let clearPending = null;

// A touch-up can close/unmount the modal before its compatibility click is
// dispatched. This event-owned guard intentionally survives that unmount; it
// retains coordinates only, never the modal/node. It is removed by the click,
// next physical gesture, keyboard input or window blur, with no timer window.
export function consumeTouchCompatibilityClick({ clientX, clientY, pointerId }) {
  clearPending?.();
  const clear = () => {
    document.removeEventListener('click', click, true);
    document.removeEventListener('pointerdown', clear, true);
    document.removeEventListener('keydown', clear, true);
    window.removeEventListener('blur', clear);
    if (clearPending === clear) clearPending = null;
  };
  const click = event => {
    const sameLocation = Math.hypot(event.clientX - clientX, event.clientY - clientY) < 10;
    const matchingPointer = !event.pointerType || (event.pointerType === 'touch' && event.pointerId === pointerId);
    const touchSource = event.sourceCapabilities?.firesTouchEvents;
    if (event.detail > 0 && sameLocation && matchingPointer && touchSource !== false) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    clear();
  };
  clearPending = clear;
  document.addEventListener('click', click, true);
  document.addEventListener('pointerdown', clear, true);
  document.addEventListener('keydown', clear, true);
  window.addEventListener('blur', clear);
  return clear;
}
