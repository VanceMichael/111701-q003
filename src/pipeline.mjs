import { normalizePage } from './adapter.mjs';
import { reconcileRecord, SCHEDULE_ISSUE_LABELS, SCHEDULE_STATUS_LABELS } from './reconcile.mjs';
import { readSource } from './source.mjs';
import { RecordStore } from './store.mjs';

export async function collect({ source = readSource, store = new RecordStore() } = {}) {
  const page = await source();
  const records = normalizePage(page).map((record) => {
    const previous = store.get(record.source, record.id);
    return store.save(reconcileRecord(previous, record));
  });
  return { source: page.source, observedAt: page.observedAt ?? null, records, store };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await collect();
  console.log(JSON.stringify({
    source: result.source,
    count: result.records.length,
    records: result.records.map((record) => ({
      id: record.id,
      name: record.name,
      hours: record.schedule.hours,
      status: SCHEDULE_STATUS_LABELS[record.schedule.status] ?? record.schedule.status,
      issues: record.schedule.issues.map((code) => SCHEDULE_ISSUE_LABELS[code] ?? code),
    })),
  }, null, 2));
}
