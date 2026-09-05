import { useState } from 'react';
import { zhCN } from 'date-fns/locale';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  calendarDay,
  learningDays,
  scheduleForDay,
} from '@/lib/study-schedule';
import { examSchedule } from '@/lib/exam-session';
import type { ReviewRecord } from '@/lib/sentence-words';
import type { ListeningDay } from '@/lib/study-dashboard';
import type { Word } from '@/lib/words';

export function StudyCalendar({
  open,
  onOpenChange,
  history,
  listening,
  reviews,
  words,
  dailyNew,
  examSession,
  consolidationDays,
  onStart,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  history: Record<string, { reviewed: number; learned?: number }>;
  listening: Record<string, ListeningDay>;
  reviews: Record<string, ReviewRecord>;
  words: Word[];
  dailyNew: number;
  examSession: string;
  consolidationDays: number;
  onStart: () => void;
}) {
  const [selected, setSelected] = useState(() => new Date());
  const [month, setMonth] = useState(() => new Date());
  const today = calendarDay(new Date());
  const day = calendarDay(selected);
  const exam = examSchedule(examSession);
  const schedule = scheduleForDay(
    day,
    today,
    words,
    reviews,
    dailyNew,
    exam.date,
    consolidationDays,
    history[today]?.learned ?? 0,
  );
  const completed = learningDays(history, listening);
  const record = history[day];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl">学习日程</DialogTitle>
          <DialogDescription>
            已学习 {completed.length} 天。点选日期，查看记录或复习安排。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 sm:grid-cols-[auto_1fr]">
          <div>
            <Calendar
              mode="single"
              required
              locale={zhCN}
              weekStartsOn={1}
              selected={selected}
              onSelect={setSelected}
              month={month}
              onMonthChange={setMonth}
              className="mx-auto rounded-xl border border-border [--cell-size:2.15rem]"
              modifiers={{
                studied: completed.map((key) => new Date(`${key}T12:00:00`)),
                exam: exam.confirmed ? new Date(`${exam.date}T12:00:00`) : [],
              }}
              modifiersClassNames={{
                studied:
                  'underline decoration-primary decoration-2 underline-offset-4',
                exam: 'ring-1 ring-inset ring-primary rounded-lg',
              }}
            />
            <p className="mt-3 text-xs text-muted-foreground">
              下划线：已学习　描边：考试日
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => {
                const now = new Date();
                setSelected(now);
                setMonth(now);
              }}
            >
              回到今天
            </Button>
          </div>
          <section
            className="min-w-0 rounded-2xl bg-secondary/45 p-5"
            aria-label="所选日期安排"
          >
            <h2 className="text-lg font-semibold">
              {selected.toLocaleDateString('zh-CN', {
                month: 'long',
                day: 'numeric',
                weekday: 'short',
              })}
              {day === today ? ' · 今天' : ''}
            </h2>
            {day <= today && (
              <div className="mt-4 space-y-2 text-sm leading-6">
                <p className="font-medium">
                  {completed.includes(day) ? '当天记录' : '当天暂无学习记录'}
                </p>
                <p>
                  新学 {record?.learned ?? 0} 词 · 回忆 {record?.reviewed ?? 0}{' '}
                  次
                </p>
                <p>精听 {listening[day]?.completed ?? 0} 句</p>
              </div>
            )}
            {!schedule.past && (
              <div className="mt-5 space-y-3 border-t border-border pt-4 text-sm leading-6">
                <p className="font-medium">
                  {day === today ? '接下来' : '预计安排'}
                </p>
                <p>
                  {day === today ? '待复习' : '已排定复习'}{' '}
                  <strong>{schedule.due.length}</strong> 词
                  {schedule.newWords > 0
                    ? ` · 新学${day === today ? '最多' : '约'} ${schedule.newWords} 词`
                    : ' · 以巩固为主'}
                </p>
                {schedule.due.length > 0 && (
                  <p className="text-muted-foreground">
                    {schedule.due
                      .slice(0, 5)
                      .map((word) => word.word)
                      .join(' / ')}
                    {schedule.due.length > 5 ? ' 等' : ''}
                  </p>
                )}
                <p className="text-muted-foreground">
                  {schedule.examPassed
                    ? '目标场次已过，可在日历图标处调整考试场次。'
                    : '建议精听一组句子，再跟读不熟悉的片段。'}
                </p>
                <p className="text-xs text-muted-foreground">
                  后续复习量会随记忆情况调整，新词量按当前计划估算。
                </p>
              </div>
            )}
            {exam.confirmed && day === exam.date && (
              <p className="mt-4 font-medium text-primary">
                今天是四六级笔试日。
              </p>
            )}
            {day === today && (
              <Button className="mt-5 w-full" onClick={onStart}>
                回到今日学习
              </Button>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
