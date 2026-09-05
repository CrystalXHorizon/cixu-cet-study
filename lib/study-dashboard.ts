export function normalizeNickname(value: unknown) {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ').slice(0, 24)
    : '';
}

export function greeting(name: string, now = new Date()) {
  const hour = now.getHours();
  const salutation =
    hour < 6
      ? '夜深了'
      : hour < 11
        ? '早上好'
        : hour < 14
          ? '中午好'
          : hour < 18
            ? '下午好'
            : '晚上好';
  return `${salutation}，${normalizeNickname(name) || '同学'}`;
}

export function progressPercent(completed: number, total: number) {
  return total > 0 ? Math.min(100, Math.max(0, (completed / total) * 100)) : 0;
}

export type ListeningDay = { completed: number; understood: number };

export function restoreListeningHistory(
  value: unknown,
): Record<string, ListeningDay> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([date, entry]) =>
        /^\d{4}-\d{2}-\d{2}$/.test(date) &&
        entry &&
        Number.isFinite(entry.completed) &&
        Number.isFinite(entry.understood) &&
        entry.completed >= 0 &&
        entry.understood >= 0 &&
        entry.understood <= entry.completed,
    ),
  );
}
