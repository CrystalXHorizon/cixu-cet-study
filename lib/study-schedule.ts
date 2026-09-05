import type { ReviewRecord } from './sentence-words';
import type { ListeningDay } from './study-dashboard';
import type { Word } from './words';

export function calendarDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function learningDays(
  history: Record<string, { reviewed: number; learned?: number }>,
  listening: Record<string, ListeningDay>,
) {
  return [...new Set([...Object.keys(history), ...Object.keys(listening)])]
    .filter(
      (day) =>
        (history[day]?.reviewed ?? 0) > 0 ||
        (history[day]?.learned ?? 0) > 0 ||
        (listening[day]?.completed ?? 0) > 0,
    )
    .sort();
}
export function scheduleForDay(
  day: string,
  today: string,
  words: Word[],
  reviews: Record<string, ReviewRecord>,
  dailyNew: number,
  examDate: string,
  consolidationDays: number,
  todayLearned = 0,
) {
  const due =
    day < today
      ? []
      : words.filter((word) => {
          const date = reviews[word.id]?.due;
          return date && (day === today ? date <= today : date === day);
        });
  const daysAhead = Math.round(
    (Date.parse(`${day}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) /
      86400000,
  );
  const daysToExam = Math.round(
    (Date.parse(`${examDate}T12:00:00Z`) - Date.parse(`${day}T12:00:00Z`)) /
      86400000,
  );
  const remaining = words.filter((word) => !reviews[word.id]).length;
  const todayAllowance = Math.max(0, dailyNew - todayLearned);
  const plannedBefore =
    daysAhead > 0 ? todayAllowance + (daysAhead - 1) * dailyNew : 0;
  const newWords =
    day < today || daysToExam <= consolidationDays
      ? 0
      : Math.max(
          0,
          Math.min(
            day === today ? todayAllowance : dailyNew,
            remaining - plannedBefore,
          ),
        );
  return { due, newWords, past: day < today, examPassed: day > examDate };
}
