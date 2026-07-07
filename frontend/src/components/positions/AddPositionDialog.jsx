import { useEffect, useState } from 'react';
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField,
} from '@mui/material';

// Shared "Register Position（買値を登録）" dialog — used by the Positions page
// (blank) and the Markets 360 buy-signal card (prefilled from the signal's
// trigger/stop). Purely presentational: the caller owns the mutation.
const EMPTY_FORM = { symbol: '', entry_price: '', entry_date: '', initial_stop: '', shares: '', notes: '' };

export default function AddPositionDialog({
  open, onClose, onSubmit, isSubmitting, submitError, initialValues,
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  // Re-seed the form each time the dialog opens (prefill from a buy signal).
  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY_FORM, ...(initialValues || {}) });
    }
  }, [open, initialValues]);

  const entry = parseFloat(form.entry_price);
  const stop = parseFloat(form.initial_stop);
  const stopInvalid = form.initial_stop !== '' && Number.isFinite(entry) && Number.isFinite(stop) && stop >= entry;
  const stopPct = !stopInvalid && Number.isFinite(entry) && Number.isFinite(stop) && entry > 0
    ? ((entry - stop) / entry) * 100 : null;
  const canSubmit = form.symbol.trim() && Number.isFinite(entry) && entry > 0 && form.entry_date && !stopInvalid;

  const submit = () => onSubmit({
    symbol: form.symbol.trim().toUpperCase(),
    entry_price: entry,
    entry_date: form.entry_date,
    initial_stop: form.initial_stop === '' ? null : stop,
    shares: form.shares === '' ? null : parseFloat(form.shares),
    notes: form.notes || null,
  });

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Register Position（買値を登録）</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField
            label="Symbol" value={form.symbol} onChange={set('symbol')} size="small" autoFocus
            inputProps={{ 'data-testid': 'position-symbol' }}
          />
          <TextField
            label="Entry price（買値）" value={form.entry_price} onChange={set('entry_price')}
            size="small" type="number" inputProps={{ step: 'any', 'data-testid': 'position-entry' }}
          />
          <TextField
            label="Entry date" value={form.entry_date} onChange={set('entry_date')}
            size="small" type="date" InputLabelProps={{ shrink: true }}
            inputProps={{ 'data-testid': 'position-date' }}
          />
          <TextField
            label="Initial stop（損切りライン）" value={form.initial_stop} onChange={set('initial_stop')}
            size="small" type="number" error={stopInvalid}
            helperText={stopInvalid
              ? 'Stop must be below the entry price（損切りは買値より下）'
              : (stopPct != null ? `リスク ${stopPct.toFixed(1)}%（1R）— Minervini上限は7-8%` : '任意：未設定ならR倍数は計算されません')}
            inputProps={{ step: 'any', 'data-testid': 'position-stop' }}
          />
          <TextField
            label="Shares（株数・任意）" value={form.shares} onChange={set('shares')}
            size="small" type="number" inputProps={{ step: 'any' }}
          />
          <TextField label="Notes" value={form.notes} onChange={set('notes')} size="small" multiline maxRows={3} />
          {submitError ? <Alert severity="error">{submitError}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ minHeight: 44 }}>Cancel</Button>
        <Button
          variant="contained" onClick={submit} disabled={!canSubmit || isSubmitting}
          data-testid="position-submit" sx={{ minHeight: 44 }}
        >
          {isSubmitting ? 'Saving…' : 'Register'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
