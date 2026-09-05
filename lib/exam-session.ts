// A planning estimate, not an announced exam date. The UI exposes sessions only.
export function examPlanningDate(session: string) {
  return `${normalizeExamSession(session)}-15`;
}

export function nextExamSession(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  return `${year}-${month <= 6 ? '06' : '12'}`;
}

export function normalizeExamSession(value: unknown, now = new Date()) {
  if (typeof value !== 'string') return nextExamSession(now);
  const match = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(value);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12)
    return nextExamSession(now);
  return `${match[1]}-${Number(match[2]) <= 6 ? '06' : '12'}`;
}

export function examSessionLabel(session: string) {
  const [year, month] = normalizeExamSession(session).split('-');
  return `${year} 年 ${Number(month)} 月`;
}

export function examSessionOptions(selected: string, now = new Date()) {
  const first = nextExamSession(now);
  const choices = new Set([normalizeExamSession(selected, now)]);
  for (let year = now.getFullYear(); year <= now.getFullYear() + 3; year++) {
    for (const month of ['06', '12']) {
      const value = `${year}-${month}`;
      if (value >= first) choices.add(value);
    }
  }
  return [...choices].sort().map((value) => ({
    value,
    label: examSessionLabel(value),
    disabled: value < first,
  }));
}
