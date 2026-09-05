'use client';

import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleAlert,
  Download,
  Gauge,
  LayoutGrid,
  ListChecks,
  RotateCcw,
  Search,
  Settings,
  Star,
  TrendingUp,
  Upload,
  Volume2,
  X,
} from 'lucide-react';
import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { getWordsForLevel, WORDS, type Word, type WordLevel } from '@/lib/words';

type View = 'today' | 'words' | 'mistakes' | 'progress' | 'review';
type WordFilter = 'all' | 'new' | 'learning' | 'mastered';
type SessionMode = 'daily' | 'mistakes';
type QuestionMode = 'recognition' | 'spelling';

type ReviewRecord = {
  interval: number;
  due: string;
  correct: number;
  wrong: number;
  correctStreak: number;
  lastReviewed: string;
};

type DayRecord = {
  reviewed: number;
  correct: number;
};

type StudyState = {
  version: 1;
  initialized: boolean;
  level: WordLevel;
  dailyGoal: number;
  reviews: Record<string, ReviewRecord>;
  mistakes: string[];
  saved: string[];
  history: Record<string, DayRecord>;
  streak: number;
  lastStudyDate?: string;
};

type WebMCPTool = {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
  };
  execute(input: unknown): unknown | Promise<unknown>;
};

type WebMCPContext = {
  registerTool(
    tool: WebMCPTool,
    options?: { signal?: AbortSignal },
  ): void | Promise<void>;
};

declare global {
  interface Document {
    modelContext?: WebMCPContext;
  }
}

const STORAGE_KEY = 'cixu-study-state-v1';

const EMPTY_STATE: StudyState = {
  version: 1,
  initialized: false,
  level: 'cet6',
  dailyGoal: 20,
  reviews: {},
  mistakes: [],
  saved: [],
  history: {},
  streak: 0,
};

const NAV_ITEMS = [
  { id: 'today' as const, label: '今日', icon: LayoutGrid },
  { id: 'words' as const, label: '词库', icon: BookOpen },
  { id: 'mistakes' as const, label: '错词', icon: CircleAlert },
  { id: 'progress' as const, label: '进度', icon: TrendingUp },
];

function dayKey(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function addDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return dayKey(date);
}

function wordStatus(record?: ReviewRecord): WordFilter {
  if (!record) return 'new';
  if (record.interval >= 14 || record.correct >= 4) return 'mastered';
  return 'learning';
}

function levelLabel(level: WordLevel) {
  return level === 'cet4' ? '四级词汇' : '六级词汇';
}

function speakWord(word: string) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = 'en-US';
  utterance.rate = 0.82;
  window.speechSynthesis.speak(utterance);
}

function updateStreak(state: StudyState) {
  const today = dayKey();
  if (state.lastStudyDate === today) {
    return { streak: state.streak, lastStudyDate: today };
  }
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return {
    streak: state.lastStudyDate === dayKey(yesterday) ? state.streak + 1 : 1,
    lastStudyDate: today,
  };
}

export function VocabApp() {
  const [study, setStudy] = useState<StudyState>(EMPTY_STATE);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>('today');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [wordFilter, setWordFilter] = useState<WordFilter>('all');
  const [setupLevel, setSetupLevel] = useState<WordLevel>('cet6');
  const [setupGoal, setSetupGoal] = useState(20);
  const [onboardingStep, setOnboardingStep] = useState<'setup' | 'quiz' | 'result'>(
    'setup',
  );
  const [diagnosticIndex, setDiagnosticIndex] = useState(0);
  const [diagnosticKnown, setDiagnosticKnown] = useState<string[]>([]);
  const [sessionIds, setSessionIds] = useState<string[]>([]);
  const [sessionIndex, setSessionIndex] = useState(0);
  const [sessionMode, setSessionMode] = useState<SessionMode>('daily');
  const [revealed, setRevealed] = useState(false);
  const [spellingAnswer, setSpellingAnswer] = useState('');
  const [spellingResult, setSpellingResult] = useState<boolean | null>(null);
  const [sessionStats, setSessionStats] = useState({ reviewed: 0, correct: 0 });
  const [sessionDone, setSessionDone] = useState(false);
  const [notice, setNotice] = useState('');
  const importRef = useRef<HTMLInputElement>(null);
  const stateRef = useRef(study);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as StudyState;
        if (parsed.version === 1) setStudy(parsed);
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    stateRef.current = study;
    if (ready) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(study));
    }
  }, [ready, study]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(''), 2400);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const activeWords = useMemo(
    () => getWordsForLevel(study.level),
    [study.level],
  );
  const wordMap = useMemo(
    () => new Map(WORDS.map((item) => [item.id, item])),
    [],
  );
  const diagnosticWords = useMemo(() => {
    const pool = getWordsForLevel(setupLevel);
    return setupLevel === 'cet6' ? pool.slice(-5) : pool.slice(2, 7);
  }, [setupLevel]);

  const today = dayKey();
  const dueWords = activeWords.filter((word) => {
    const record = study.reviews[word.id];
    return record && record.due <= today;
  });
  const newWords = activeWords.filter((word) => !study.reviews[word.id]);
  const masteredCount = activeWords.filter(
    (word) => wordStatus(study.reviews[word.id]) === 'mastered',
  ).length;
  const learningCount = activeWords.filter(
    (word) => wordStatus(study.reviews[word.id]) === 'learning',
  ).length;
  const todayRecord = study.history[today] ?? { reviewed: 0, correct: 0 };
  const todayTarget = Math.max(
    1,
    dueWords.length + Math.min(study.dailyGoal, newWords.length),
  );
  const todayProgress = Math.min(
    100,
    Math.round((todayRecord.reviewed / todayTarget) * 100),
  );

  function sessionQueue(mode: SessionMode, source = study) {
    const pool = getWordsForLevel(source.level);
    if (mode === 'mistakes') {
      return source.mistakes.filter((id) => pool.some((word) => word.id === id));
    }
    const due = pool
      .filter((word) => {
        const record = source.reviews[word.id];
        return record && record.due <= dayKey();
      })
      .map((word) => word.id);
    const fresh = pool
      .filter((word) => !source.reviews[word.id])
      .slice(0, source.dailyGoal)
      .map((word) => word.id);
    return Array.from(new Set([...due, ...fresh])).slice(
      0,
      Math.max(source.dailyGoal, 10),
    );
  }

  function startSession(mode: SessionMode) {
    const queue = sessionQueue(mode);
    if (queue.length === 0) {
      setNotice(mode === 'mistakes' ? '错词已经全部清空' : '今天的任务已经完成');
      return false;
    }
    setSessionMode(mode);
    setSessionIds(queue);
    setSessionIndex(0);
    setSessionStats({ reviewed: 0, correct: 0 });
    setSessionDone(false);
    setRevealed(false);
    setSpellingAnswer('');
    setSpellingResult(null);
    setView('review');
    return true;
  }

  useEffect(() => {
    const context = document.modelContext;
    if (!ready || !context?.registerTool) return;
    const lifecycle = new AbortController();

    void Promise.resolve(
      context.registerTool(
        {
          name: 'get_vocabulary_progress',
          title: '查看背词进度',
          description: '读取当前设备上的四六级词汇学习进度，不修改学习记录。',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, untrustedContentHint: false },
          execute() {
            const current = stateRef.current;
            const pool = getWordsForLevel(current.level);
            const mastered = pool.filter(
              (word) => wordStatus(current.reviews[word.id]) === 'mastered',
            ).length;
            return {
              level: current.level,
              total: pool.length,
              mastered,
              mistakes: current.mistakes.length,
              streak: current.streak,
            };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => undefined);

    void Promise.resolve(
      context.registerTool(
        {
          name: 'start_vocabulary_review',
          title: '开始单词复习',
          description: '打开今日复习或错词复习，并生成当前学习队列。',
          inputSchema: {
            type: 'object',
            properties: {
              mode: { type: 'string', enum: ['daily', 'mistakes'] },
            },
            required: ['mode'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute(input) {
            const mode =
              typeof input === 'object' &&
              input !== null &&
              'mode' in input &&
              (input as { mode: unknown }).mode;
            if (mode !== 'daily' && mode !== 'mistakes') {
              throw new Error('mode 必须是 daily 或 mistakes');
            }
            const current = stateRef.current;
            if (!current.initialized) {
              throw new Error('请先完成首次词汇设置');
            }
            const queue = sessionQueue(mode, current);
            if (queue.length === 0) {
              throw new Error(mode === 'mistakes' ? '当前没有错词' : '今天没有待复习单词');
            }
            setSessionMode(mode);
            setSessionIds(queue);
            setSessionIndex(0);
            setSessionStats({ reviewed: 0, correct: 0 });
            setSessionDone(false);
            setRevealed(false);
            setSpellingAnswer('');
            setSpellingResult(null);
            setView('review');
            return { mode, count: queue.length, status: 'started' };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => undefined);

    return () => lifecycle.abort();
  }, [ready]);

  function beginDiagnostic() {
    setDiagnosticIndex(0);
    setDiagnosticKnown([]);
    setOnboardingStep('quiz');
  }

  function answerDiagnostic(selectedMeaning: string) {
    const word = diagnosticWords[diagnosticIndex];
    const correct = selectedMeaning === word.meaning;
    if (correct) setDiagnosticKnown((current) => [...current, word.id]);
    if (diagnosticIndex === diagnosticWords.length - 1) {
      setOnboardingStep('result');
    } else {
      setDiagnosticIndex((current) => current + 1);
    }
  }

  function completeOnboarding() {
    const reviews = diagnosticKnown.reduce<Record<string, ReviewRecord>>(
      (result, id) => {
        result[id] = {
          interval: 7,
          due: addDays(7),
          correct: 1,
          wrong: 0,
          correctStreak: 1,
          lastReviewed: dayKey(),
        };
        return result;
      },
      {},
    );
    setStudy({
      ...EMPTY_STATE,
      initialized: true,
      level: setupLevel,
      dailyGoal: setupGoal,
      reviews,
    });
    setView('today');
  }

  function recordGrade(word: Word, grade: 0 | 1 | 2) {
    setStudy((current) => {
      const previous = current.reviews[word.id];
      const previousInterval = previous?.interval ?? 0;
      const interval =
        grade === 0
          ? 1
          : grade === 1
            ? Math.max(2, Math.round(previousInterval * 1.4) || 2)
            : Math.max(4, Math.round(previousInterval * 2.1) || 4);
      const correctStreak = grade === 2 ? (previous?.correctStreak ?? 0) + 1 : 0;
      const mistakes =
        grade === 0
          ? Array.from(new Set([...current.mistakes, word.id]))
          : grade === 2 && correctStreak >= 2
            ? current.mistakes.filter((id) => id !== word.id)
            : current.mistakes;
      const history = current.history[today] ?? { reviewed: 0, correct: 0 };
      const streakData = updateStreak(current);
      return {
        ...current,
        ...streakData,
        mistakes,
        reviews: {
          ...current.reviews,
          [word.id]: {
            interval,
            due: addDays(interval),
            correct: (previous?.correct ?? 0) + (grade === 2 ? 1 : 0),
            wrong: (previous?.wrong ?? 0) + (grade === 0 ? 1 : 0),
            correctStreak,
            lastReviewed: today,
          },
        },
        history: {
          ...current.history,
          [today]: {
            reviewed: history.reviewed + 1,
            correct: history.correct + (grade === 2 ? 1 : 0),
          },
        },
      };
    });
    setSessionStats((current) => ({
      reviewed: current.reviewed + 1,
      correct: current.correct + (grade === 2 ? 1 : 0),
    }));
  }

  function advanceSession() {
    if (sessionIndex >= sessionIds.length - 1) {
      setSessionDone(true);
      return;
    }
    setSessionIndex((current) => current + 1);
    setRevealed(false);
    setSpellingAnswer('');
    setSpellingResult(null);
  }

  function gradeRecognition(word: Word, grade: 0 | 1 | 2) {
    recordGrade(word, grade);
    advanceSession();
  }

  function checkSpelling(event?: FormEvent) {
    event?.preventDefault();
    const word = wordMap.get(sessionIds[sessionIndex]);
    if (!word || spellingResult !== null) return;
    const correct =
      spellingAnswer.trim().toLocaleLowerCase() === word.word.toLocaleLowerCase();
    setSpellingResult(correct);
    recordGrade(word, correct ? 2 : 0);
  }

  useEffect(() => {
    if (view !== 'review' || sessionDone) return;
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT') return;
      const word = wordMap.get(sessionIds[sessionIndex]);
      if (!word) return;
      const mode: QuestionMode = sessionIndex % 3 === 1 ? 'spelling' : 'recognition';
      if (mode === 'recognition' && !revealed && event.code === 'Space') {
        event.preventDefault();
        setRevealed(true);
      } else if (mode === 'recognition' && revealed) {
        if (event.key === '1') gradeRecognition(word, 0);
        if (event.key === '2') gradeRecognition(word, 1);
        if (event.key === '3') gradeRecognition(word, 2);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [revealed, sessionDone, sessionIds, sessionIndex, view, wordMap]);

  function toggleSaved(id: string) {
    setStudy((current) => ({
      ...current,
      saved: current.saved.includes(id)
        ? current.saved.filter((item) => item !== id)
        : [...current.saved, id],
    }));
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(study, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'cixu-study-backup.json';
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice('学习记录已经导出');
  }

  function importData(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as StudyState;
        if (parsed.version !== 1 || !parsed.reviews || !parsed.history) {
          throw new Error('invalid');
        }
        setStudy(parsed);
        setSettingsOpen(false);
        setNotice('学习记录已经恢复');
      } catch {
        setNotice('备份文件无法识别');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  function resetData() {
    if (!window.confirm('确定清空当前设备上的全部学习记录吗？')) return;
    setStudy(EMPTY_STATE);
    setSetupLevel('cet6');
    setSetupGoal(20);
    setOnboardingStep('setup');
    setSettingsOpen(false);
  }

  if (!ready) {
    return (
      <main className="grid min-h-screen place-items-center bg-background">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="size-2 animate-pulse rounded-full bg-primary" />
          正在整理今日任务
        </div>
      </main>
    );
  }

  if (!study.initialized) {
    return (
      <Onboarding
        step={onboardingStep}
        level={setupLevel}
        goal={setupGoal}
        words={diagnosticWords}
        index={diagnosticIndex}
        knownCount={diagnosticKnown.length}
        onLevelChange={setSetupLevel}
        onGoalChange={setSetupGoal}
        onBegin={beginDiagnostic}
        onAnswer={answerDiagnostic}
        onComplete={completeOnboarding}
      />
    );
  }

  const currentWord = wordMap.get(sessionIds[sessionIndex]);
  const questionMode: QuestionMode =
    sessionIndex % 3 === 1 ? 'spelling' : 'recognition';

  if (view === 'review' && currentWord) {
    return (
      <ReviewSession
        word={currentWord}
        mode={questionMode}
        sessionMode={sessionMode}
        index={sessionIndex}
        total={sessionIds.length}
        revealed={revealed}
        spellingAnswer={spellingAnswer}
        spellingResult={spellingResult}
        stats={sessionStats}
        done={sessionDone}
        onReveal={() => setRevealed(true)}
        onGrade={(grade) => gradeRecognition(currentWord, grade)}
        onSpellingChange={setSpellingAnswer}
        onCheckSpelling={checkSpelling}
        onAdvance={advanceSession}
        onSpeak={() => speakWord(currentWord.word)}
        onExit={() => setView('today')}
      />
    );
  }

  return (
    <main className="min-h-screen bg-background pb-20 text-foreground lg:pb-0">
      <AppHeader
        level={study.level}
        streak={study.streak}
        onSettings={() => setSettingsOpen(true)}
      />

      <div className="mx-auto grid max-w-[1180px] gap-8 px-5 py-8 lg:grid-cols-[180px_minmax(0,1fr)] lg:px-8 lg:py-11">
        <SideNavigation
          view={view}
          mistakes={study.mistakes.length}
          onChange={setView}
          onSettings={() => setSettingsOpen(true)}
        />

        <section>
          {view === 'today' && (
            <TodayView
              study={study}
              activeWords={activeWords}
              dueCount={dueWords.length}
              newCount={newWords.length}
              masteredCount={masteredCount}
              learningCount={learningCount}
              todayRecord={todayRecord}
              todayTarget={todayTarget}
              todayProgress={todayProgress}
              onStart={() => startSession('daily')}
              onMistakes={() => startSession('mistakes')}
            />
          )}
          {view === 'words' && (
            <WordLibrary
              words={activeWords}
              reviews={study.reviews}
              saved={study.saved}
              search={search}
              filter={wordFilter}
              onSearch={setSearch}
              onFilter={setWordFilter}
              onSave={toggleSaved}
              onSpeak={speakWord}
            />
          )}
          {view === 'mistakes' && (
            <MistakeBook
              words={study.mistakes
                .map((id) => wordMap.get(id))
                .filter((word): word is Word => Boolean(word))}
              reviews={study.reviews}
              onStart={() => startSession('mistakes')}
              onSpeak={speakWord}
            />
          )}
          {view === 'progress' && (
            <ProgressView
              study={study}
              total={activeWords.length}
              mastered={masteredCount}
              learning={learningCount}
            />
          )}
        </section>
      </div>

      <MobileNavigation
        view={view}
        mistakes={study.mistakes.length}
        onChange={setView}
      />

      <SettingsDialog
        open={settingsOpen}
        study={study}
        onOpenChange={setSettingsOpen}
        onStudyChange={setStudy}
        onExport={exportData}
        onImport={() => importRef.current?.click()}
        onReset={resetData}
      />
      <input
        ref={importRef}
        className="hidden"
        type="file"
        accept="application/json"
        onChange={importData}
      />

      {notice && (
        <div
          className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-sm text-background shadow-lg lg:bottom-7"
          role="status"
        >
          {notice}
        </div>
      )}
    </main>
  );
}

function AppHeader({
  level,
  streak,
  onSettings,
}: {
  level: WordLevel;
  streak: number;
  onSettings(): void;
}) {
  return (
    <header className="border-b border-border/80 bg-background/95">
      <div className="mx-auto flex h-16 max-w-[1180px] items-center justify-between px-5 lg:px-8">
        <button className="flex items-center gap-2.5" onClick={() => window.location.reload()}>
          <span className="grid size-8 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
            词
          </span>
          <span className="text-[17px] font-semibold tracking-[0.12em]">词序</span>
        </button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" className="hidden text-muted-foreground sm:flex" onClick={onSettings}>
            {levelLabel(level)}
            <ChevronRight data-icon="inline-end" />
          </Button>
          <span className="rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium">
            连续 {streak} 天
          </span>
        </div>
      </div>
    </header>
  );
}

function SideNavigation({
  view,
  mistakes,
  onChange,
  onSettings,
}: {
  view: View;
  mistakes: number;
  onChange(view: View): void;
  onSettings(): void;
}) {
  return (
    <aside className="hidden lg:block">
      <nav className="sticky top-8 flex h-[calc(100vh-7rem)] flex-col" aria-label="主导航">
        <div className="space-y-1">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              variant="ghost"
              onClick={() => onChange(id)}
              className={cn(
                'h-10 w-full justify-start gap-3 px-3 font-normal text-muted-foreground',
                view === id && 'bg-secondary font-medium text-foreground',
              )}
            >
              <Icon className="size-[17px]" strokeWidth={1.8} />
              {label}
              {id === 'mistakes' && mistakes > 0 && (
                <span className="ml-auto text-xs tabular-nums">{mistakes}</span>
              )}
            </Button>
          ))}
        </div>
        <Button
          variant="ghost"
          onClick={onSettings}
          className="mt-auto h-10 justify-start gap-3 px-3 font-normal text-muted-foreground"
        >
          <Settings className="size-[17px]" strokeWidth={1.8} />
          设置
        </Button>
      </nav>
    </aside>
  );
}

function MobileNavigation({
  view,
  mistakes,
  onChange,
}: {
  view: View;
  mistakes: number;
  onChange(view: View): void;
}) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-border bg-background/95 px-2 py-2 backdrop-blur lg:hidden"
      aria-label="移动端导航"
    >
      {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
        <button
          className={cn(
            'relative flex flex-col items-center gap-1 rounded-lg py-1.5 text-[11px]',
            view === id ? 'font-medium text-primary' : 'text-muted-foreground',
          )}
          onClick={() => onChange(id)}
          key={id}
        >
          <Icon className="size-[18px]" strokeWidth={1.8} />
          {label}
          {id === 'mistakes' && mistakes > 0 && (
            <span className="absolute right-[28%] top-0 size-1.5 rounded-full bg-destructive" />
          )}
        </button>
      ))}
    </nav>
  );
}

function TodayView({
  study,
  activeWords,
  dueCount,
  newCount,
  masteredCount,
  learningCount,
  todayRecord,
  todayTarget,
  todayProgress,
  onStart,
  onMistakes,
}: {
  study: StudyState;
  activeWords: Word[];
  dueCount: number;
  newCount: number;
  masteredCount: number;
  learningCount: number;
  todayRecord: DayRecord;
  todayTarget: number;
  todayProgress: number;
  onStart(): void;
  onMistakes(): void;
}) {
  const nextWord =
    activeWords.find((word) => {
      const record = study.reviews[word.id];
      return record && record.due <= dayKey();
    }) ??
    activeWords.find((word) => !study.reviews[word.id]) ??
    activeWords[0];
  const correctRate =
    todayRecord.reviewed > 0
      ? Math.round((todayRecord.correct / todayRecord.reviewed) * 100)
      : 0;

  return (
    <>
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-sm text-muted-foreground">
            {new Intl.DateTimeFormat('zh-CN', {
              month: 'long',
              day: 'numeric',
              weekday: 'long',
            }).format(new Date())}
          </p>
          <h1 className="font-heading text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
            今天继续，别赶进度。
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {levelLabel(study.level)} · 每日新词 {study.dailyGoal}
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.85fr)]">
        <article className="relative overflow-hidden rounded-[22px] bg-primary p-6 text-primary-foreground sm:p-8">
          <div className="absolute -right-12 -top-12 size-48 rounded-full border border-white/10" />
          <div className="absolute -right-2 top-20 size-24 rounded-full border border-white/10" />
          <div className="relative">
            <div className="mb-12 flex items-center gap-2 text-sm text-primary-foreground/70">
              <RotateCcw className="size-4" />
              {todayRecord.reviewed >= todayTarget ? '加练一组' : '今日复习'}
            </div>
            <p className="mb-2 text-sm text-primary-foreground/65">下一词</p>
            <h2 className="font-heading text-[clamp(2.35rem,6vw,4.6rem)] font-semibold leading-none tracking-[-0.055em]">
              {nextWord.word}
            </h2>
            <p className="mt-4 text-base text-primary-foreground/75">
              {nextWord.phonetic} · {nextWord.partOfSpeech} {nextWord.meaning}
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Button
                size="lg"
                className="h-11 rounded-full bg-[#f6f0e2] px-5 text-[#173e34] hover:bg-white"
                onClick={onStart}
              >
                {todayRecord.reviewed > 0 ? '继续复习' : '开始复习'}
                <ArrowRight data-icon="inline-end" />
              </Button>
              <span className="text-sm text-primary-foreground/65">
                {dueCount + Math.min(study.dailyGoal, newCount)} 个词 · 约 12 分钟
              </span>
            </div>
          </div>
        </article>

        <article className="rounded-[22px] border border-border bg-card p-6 sm:p-7">
          <div className="mb-8 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">今日任务</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight">
                {todayRecord.reviewed} / {todayTarget}
              </p>
            </div>
            <span className="grid size-10 place-items-center rounded-full bg-secondary text-primary">
              <ListChecks className="size-5" />
            </span>
          </div>
          <Progress
            value={todayProgress}
            className="mb-7 [&_[data-slot=progress-track]]:h-2"
          />
          <div className="space-y-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">到期复习</span>
              <span className="font-medium">{dueCount} 个</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">今日新词</span>
              <span className="font-medium">
                {Math.min(study.dailyGoal, newCount)} 个
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">今日正确率</span>
              <span className="font-medium">{correctRate || '—'}{correctRate ? '%' : ''}</span>
            </div>
          </div>
        </article>
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-3">
        <article className="rounded-2xl border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">正在学习</p>
          <p className="mt-3 text-2xl font-semibold tracking-tight">
            {learningCount}{' '}
            <span className="text-sm font-normal text-muted-foreground">个词</span>
          </p>
        </article>
        <button
          className="group rounded-2xl border border-border bg-card p-5 text-left transition-colors hover:bg-secondary/45"
          onClick={onMistakes}
        >
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">薄弱词</p>
            <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </div>
          <p className="mt-3 text-2xl font-semibold tracking-tight">
            {study.mistakes.length}{' '}
            <span className="text-sm font-normal text-muted-foreground">个词</span>
          </p>
        </button>
        <article className="rounded-2xl border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">词库进度</p>
          <p className="mt-3 text-2xl font-semibold tracking-tight">
            {Math.round((masteredCount / activeWords.length) * 100)}%{' '}
            <span className="text-sm font-normal text-muted-foreground">
              已掌握 {masteredCount}
            </span>
          </p>
        </article>
      </div>

      <div className="mt-8 flex items-center gap-3 border-t border-border pt-5 text-xs text-muted-foreground">
        <span className="size-1.5 rounded-full bg-primary/55" />
        学习记录只保存在当前浏览器，可在设置中导出备份。
      </div>
    </>
  );
}

function WordLibrary({
  words,
  reviews,
  saved,
  search,
  filter,
  onSearch,
  onFilter,
  onSave,
  onSpeak,
}: {
  words: Word[];
  reviews: Record<string, ReviewRecord>;
  saved: string[];
  search: string;
  filter: WordFilter;
  onSearch(value: string): void;
  onFilter(value: WordFilter): void;
  onSave(id: string): void;
  onSpeak(word: string): void;
}) {
  const filtered = words.filter((word) => {
    const query = search.trim().toLocaleLowerCase();
    const matchesSearch =
      !query ||
      word.word.includes(query) ||
      word.meaning.includes(query) ||
      word.collocation.toLocaleLowerCase().includes(query);
    return (
      matchesSearch &&
      (filter === 'all' || wordStatus(reviews[word.id]) === filter)
    );
  });

  const filterLabels: Record<WordFilter, string> = {
    all: '全部',
    new: '未学习',
    learning: '学习中',
    mastered: '已掌握',
  };

  return (
    <>
      <div className="mb-7">
        <p className="mb-2 text-sm text-muted-foreground">按掌握状态浏览</p>
        <h1 className="font-heading text-3xl font-semibold tracking-[-0.035em]">
          词库
        </h1>
      </div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="搜索单词、释义或搭配"
            className="h-11 rounded-xl bg-card pl-9"
          />
        </div>
        <div className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1">
          {(Object.keys(filterLabels) as WordFilter[]).map((item) => (
            <Button
              key={item}
              variant="ghost"
              onClick={() => onFilter(item)}
              className={cn(
                'h-8 shrink-0 px-3 font-normal',
                filter === item && 'bg-secondary font-medium',
              )}
            >
              {filterLabels[item]}
            </Button>
          ))}
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {filtered.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-muted-foreground">
            没有找到符合条件的单词
          </div>
        ) : (
          filtered.map((word, index) => {
            const status = wordStatus(reviews[word.id]);
            return (
              <article
                key={word.id}
                className={cn(
                  'grid gap-4 px-5 py-5 sm:grid-cols-[minmax(170px,0.7fr)_minmax(0,1.3fr)_auto] sm:items-center',
                  index > 0 && 'border-t border-border',
                )}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-heading text-xl font-semibold">{word.word}</h2>
                    <button
                      aria-label={'播放 ' + word.word}
                      onClick={() => onSpeak(word.word)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Volume2 className="size-4" />
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{word.phonetic}</p>
                </div>
                <div>
                  <p className="text-sm">
                    <span className="mr-2 text-muted-foreground">{word.partOfSpeech}</span>
                    {word.meaning}
                  </p>
                  <p className="mt-1.5 text-xs text-muted-foreground">{word.collocation}</p>
                </div>
                <div className="flex items-center justify-between gap-2 sm:justify-end">
                  <Badge
                    variant={status === 'mastered' ? 'secondary' : 'outline'}
                    className="font-normal"
                  >
                    {status === 'new' ? '未学习' : status === 'learning' ? '学习中' : '已掌握'}
                  </Badge>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={saved.includes(word.id) ? '取消重点词' : '标为重点词'}
                    onClick={() => onSave(word.id)}
                  >
                    <Star
                      className={cn(
                        'size-4',
                        saved.includes(word.id) && 'fill-current text-[#9a6b18]',
                      )}
                    />
                  </Button>
                </div>
              </article>
            );
          })
        )}
      </div>
    </>
  );
}

function MistakeBook({
  words,
  reviews,
  onStart,
  onSpeak,
}: {
  words: Word[];
  reviews: Record<string, ReviewRecord>;
  onStart(): void;
  onSpeak(word: string): void;
}) {
  return (
    <>
      <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-sm text-muted-foreground">答错后自动加入</p>
          <h1 className="font-heading text-3xl font-semibold tracking-[-0.035em]">
            错词本
          </h1>
        </div>
        {words.length > 0 && (
          <Button className="h-10 rounded-full px-4" onClick={onStart}>
            复习这 {words.length} 个词
            <ArrowRight data-icon="inline-end" />
          </Button>
        )}
      </div>
      {words.length === 0 ? (
        <div className="rounded-[22px] border border-dashed border-border bg-card/55 px-6 py-20 text-center">
          <span className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-secondary text-primary">
            <Check className="size-5" />
          </span>
          <h2 className="font-heading text-xl font-semibold">这里暂时很干净</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            复习时答错的词会自动出现在这里。
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {words.map((word) => {
            const record = reviews[word.id];
            return (
              <article className="rounded-2xl border border-border bg-card p-5" key={word.id}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-heading text-2xl font-semibold">{word.word}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">{word.phonetic}</p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={'播放 ' + word.word}
                    onClick={() => onSpeak(word.word)}
                  >
                    <Volume2 />
                  </Button>
                </div>
                <p className="mt-6 text-sm">
                  <span className="mr-2 text-muted-foreground">{word.partOfSpeech}</span>
                  {word.meaning}
                </p>
                <div className="mt-4 flex items-center justify-between border-t border-border pt-4 text-xs text-muted-foreground">
                  <span>错误 {record?.wrong ?? 1} 次</span>
                  <span>{word.collocation}</span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

function ProgressView({
  study,
  total,
  mastered,
  learning,
}: {
  study: StudyState;
  total: number;
  mastered: number;
  learning: number;
}) {
  const lastSevenDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    const key = dayKey(date);
    return {
      key,
      label: ['日', '一', '二', '三', '四', '五', '六'][date.getDay()],
      value: study.history[key]?.reviewed ?? 0,
    };
  });
  const maxValue = Math.max(1, ...lastSevenDays.map((item) => item.value));
  const allDays = Object.values(study.history);
  const totalReviews = allDays.reduce((sum, day) => sum + day.reviewed, 0);
  const totalCorrect = allDays.reduce((sum, day) => sum + day.correct, 0);
  const accuracy = totalReviews ? Math.round((totalCorrect / totalReviews) * 100) : 0;

  return (
    <>
      <div className="mb-7">
        <p className="mb-2 text-sm text-muted-foreground">只看真正有用的数据</p>
        <h1 className="font-heading text-3xl font-semibold tracking-[-0.035em]">
          学习进度
        </h1>
      </div>
      <div className="grid gap-5 md:grid-cols-3">
        {[
          { label: '已掌握', value: mastered, suffix: '个词', icon: Check },
          { label: '累计复习', value: totalReviews, suffix: '次', icon: RotateCcw },
          { label: '整体正确率', value: accuracy || '—', suffix: accuracy ? '%' : '', icon: Gauge },
        ].map(({ label, value, suffix, icon: Icon }) => (
          <article className="rounded-2xl border border-border bg-card p-5" key={label}>
            <span className="mb-6 grid size-9 place-items-center rounded-full bg-secondary text-primary">
              <Icon className="size-4" />
            </span>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight">
              {value} <span className="text-sm font-normal text-muted-foreground">{suffix}</span>
            </p>
          </article>
        ))}
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
        <article className="rounded-[22px] border border-border bg-card p-6">
          <div className="mb-8">
            <h2 className="font-heading text-xl font-semibold">最近七天</h2>
            <p className="mt-1 text-sm text-muted-foreground">每天实际完成的复习次数</p>
          </div>
          <div className="flex h-48 items-end gap-3 sm:gap-5">
            {lastSevenDays.map((item) => (
              <div className="flex h-full flex-1 flex-col items-center justify-end gap-2" key={item.key}>
                <span className="text-xs text-muted-foreground">{item.value || ''}</span>
                <div
                  className="w-full max-w-10 rounded-t-md bg-primary/85 transition-[height]"
                  style={{ height: Math.max(4, (item.value / maxValue) * 130) }}
                />
                <span className="text-xs text-muted-foreground">周{item.label}</span>
              </div>
            ))}
          </div>
        </article>
        <article className="rounded-[22px] border border-border bg-card p-6">
          <h2 className="font-heading text-xl font-semibold">词库构成</h2>
          <div className="mt-8 space-y-6">
            {[
              ['已掌握', mastered, 'bg-primary'],
              ['学习中', learning, 'bg-[#b88a3b]'],
              ['未学习', total - mastered - learning, 'bg-border'],
            ].map(([label, value, color]) => (
              <div key={String(label)}>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium">{String(value)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn('h-full rounded-full', String(color))}
                    style={{ width: String((Number(value) / total) * 100) + '%' }}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-8 border-t border-border pt-5 text-xs leading-5 text-muted-foreground">
            “已掌握”只统计经过多轮复习、间隔达到 14 天以上的单词。
          </p>
        </article>
      </div>
    </>
  );
}

function ReviewSession({
  word,
  mode,
  sessionMode,
  index,
  total,
  revealed,
  spellingAnswer,
  spellingResult,
  stats,
  done,
  onReveal,
  onGrade,
  onSpellingChange,
  onCheckSpelling,
  onAdvance,
  onSpeak,
  onExit,
}: {
  word: Word;
  mode: QuestionMode;
  sessionMode: SessionMode;
  index: number;
  total: number;
  revealed: boolean;
  spellingAnswer: string;
  spellingResult: boolean | null;
  stats: { reviewed: number; correct: number };
  done: boolean;
  onReveal(): void;
  onGrade(grade: 0 | 1 | 2): void;
  onSpellingChange(value: string): void;
  onCheckSpelling(event?: FormEvent): void;
  onAdvance(): void;
  onSpeak(): void;
  onExit(): void;
}) {
  const progress = done ? 100 : Math.round((index / total) * 100);

  if (done) {
    const rate = stats.reviewed
      ? Math.round((stats.correct / stats.reviewed) * 100)
      : 0;
    return (
      <main className="grid min-h-screen place-items-center bg-background px-5 py-12">
        <section className="w-full max-w-xl rounded-[26px] border border-border bg-card p-7 text-center sm:p-10">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-secondary text-primary">
            <Check className="size-6" />
          </span>
          <p className="mt-7 text-sm text-muted-foreground">
            {sessionMode === 'daily' ? '今日复习' : '错词复习'}
          </p>
          <h1 className="mt-2 font-heading text-3xl font-semibold">这一组完成了</h1>
          <div className="mx-auto mt-8 grid max-w-sm grid-cols-2 divide-x divide-border rounded-2xl border border-border py-5">
            <div>
              <p className="text-2xl font-semibold">{stats.reviewed}</p>
              <p className="mt-1 text-xs text-muted-foreground">完成词数</p>
            </div>
            <div>
              <p className="text-2xl font-semibold">{rate}%</p>
              <p className="mt-1 text-xs text-muted-foreground">回忆正确率</p>
            </div>
          </div>
          <Button className="mt-8 h-11 rounded-full px-6" onClick={onExit}>
            回到今日
          </Button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background px-5 py-5 text-foreground sm:py-7">
      <header className="mx-auto flex max-w-4xl items-center gap-4">
        <Button size="icon" variant="ghost" onClick={onExit} aria-label="退出复习">
          <X />
        </Button>
        <Progress value={progress} className="flex-1 [&_[data-slot=progress-track]]:h-1.5" />
        <span className="w-14 text-right text-sm tabular-nums text-muted-foreground">
          {index + 1} / {total}
        </span>
      </header>

      <section className="mx-auto mt-[clamp(2.5rem,8vh,6rem)] max-w-3xl">
        <div className="mb-6 flex items-center justify-between text-sm text-muted-foreground">
          <span>{mode === 'recognition' ? '看到单词，回忆含义' : '根据释义，拼出单词'}</span>
          <Badge variant="outline" className="font-normal">
            {word.level === 'cet4' ? '四级' : '六级'}
          </Badge>
        </div>

        {mode === 'recognition' ? (
          <article className="rounded-[26px] border border-border bg-card p-7 sm:p-12">
            <div className="text-center">
              <button
                onClick={onSpeak}
                className="group inline-flex items-center gap-3"
                aria-label={'播放 ' + word.word}
              >
                <h1 className="font-heading text-[clamp(2.8rem,9vw,5.4rem)] font-semibold leading-none tracking-[-0.055em]">
                  {word.word}
                </h1>
                <Volume2 className="size-5 text-muted-foreground transition-colors group-hover:text-foreground" />
              </button>
              <p className="mt-4 text-sm text-muted-foreground">{word.phonetic}</p>
            </div>

            {!revealed ? (
              <div className="mt-16 text-center">
                <Button className="h-11 rounded-full px-6" onClick={onReveal}>
                  查看释义
                </Button>
                <p className="mt-3 text-xs text-muted-foreground">空格键</p>
              </div>
            ) : (
              <div className="mt-12 border-t border-border pt-8">
                <p className="text-lg">
                  <span className="mr-2 text-sm text-muted-foreground">{word.partOfSpeech}</span>
                  {word.meaning}
                </p>
                <p className="mt-5 text-sm font-medium">{word.collocation}</p>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">{word.example}</p>
                <div className="mt-9 grid gap-2 sm:grid-cols-3">
                  <Button
                    variant="outline"
                    className="h-11 justify-between px-4"
                    onClick={() => onGrade(0)}
                  >
                    忘了 <kbd className="text-xs text-muted-foreground">1</kbd>
                  </Button>
                  <Button
                    variant="outline"
                    className="h-11 justify-between px-4"
                    onClick={() => onGrade(1)}
                  >
                    模糊 <kbd className="text-xs text-muted-foreground">2</kbd>
                  </Button>
                  <Button
                    className="h-11 justify-between px-4"
                    onClick={() => onGrade(2)}
                  >
                    记得 <kbd className="text-xs text-primary-foreground/70">3</kbd>
                  </Button>
                </div>
              </div>
            )}
          </article>
        ) : (
          <article className="rounded-[26px] border border-border bg-card p-7 sm:p-12">
            <p className="text-center text-sm text-muted-foreground">{word.partOfSpeech}</p>
            <h1 className="mt-3 text-center font-heading text-2xl font-semibold sm:text-3xl">
              {word.meaning}
            </h1>
            <p className="mx-auto mt-8 max-w-xl text-center text-sm leading-7 text-muted-foreground">
              {word.example.replace(new RegExp(word.word, 'i'), '＿＿＿＿＿＿')}
            </p>
            <form className="mx-auto mt-10 max-w-md" onSubmit={onCheckSpelling}>
              <Input
                autoFocus
                autoComplete="off"
                spellCheck={false}
                value={spellingAnswer}
                disabled={spellingResult !== null}
                onChange={(event) => onSpellingChange(event.target.value)}
                placeholder="输入英文单词"
                className={cn(
                  'h-12 rounded-xl text-center text-lg',
                  spellingResult === true && 'border-primary bg-secondary/35',
                  spellingResult === false && 'border-destructive bg-destructive/5',
                )}
              />
              {spellingResult === null ? (
                <Button
                  type="submit"
                  className="mt-3 h-11 w-full rounded-xl"
                  disabled={!spellingAnswer.trim()}
                >
                  检查拼写
                </Button>
              ) : (
                <div className="mt-5">
                  <div
                    className={cn(
                      'rounded-xl px-4 py-3 text-center text-sm',
                      spellingResult
                        ? 'bg-secondary text-secondary-foreground'
                        : 'bg-destructive/8 text-destructive',
                    )}
                  >
                    {spellingResult ? '拼写正确' : '正确拼写：' + word.word}
                  </div>
                  <Button className="mt-3 h-11 w-full rounded-xl" onClick={onAdvance}>
                    下一个
                    <ArrowRight data-icon="inline-end" />
                  </Button>
                </div>
              )}
            </form>
          </article>
        )}
      </section>
    </main>
  );
}

function Onboarding({
  step,
  level,
  goal,
  words,
  index,
  knownCount,
  onLevelChange,
  onGoalChange,
  onBegin,
  onAnswer,
  onComplete,
}: {
  step: 'setup' | 'quiz' | 'result';
  level: WordLevel;
  goal: number;
  words: Word[];
  index: number;
  knownCount: number;
  onLevelChange(level: WordLevel): void;
  onGoalChange(goal: number): void;
  onBegin(): void;
  onAnswer(meaning: string): void;
  onComplete(): void;
}) {
  if (step === 'quiz') {
    const word = words[index];
    const options = [
      word.meaning,
      words[(index + 2) % words.length].meaning,
      words[(index + 3) % words.length].meaning,
    ].sort((a, b) => (a.length + index) % 3 - (b.length + index) % 3);
    return (
      <main className="min-h-screen bg-background px-5 py-8 text-foreground">
        <header className="mx-auto flex max-w-2xl items-center justify-between">
          <span className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">词</span>
            <span className="font-semibold tracking-[0.12em]">词序</span>
          </span>
          <span className="text-sm text-muted-foreground">{index + 1} / {words.length}</span>
        </header>
        <section className="mx-auto mt-[clamp(3rem,12vh,7rem)] max-w-2xl">
          <p className="text-center text-sm text-muted-foreground">快速摸底 · 请选择正确释义</p>
          <h1 className="mt-5 text-center font-heading text-[clamp(3rem,10vw,5rem)] font-semibold tracking-[-0.05em]">
            {word.word}
          </h1>
          <p className="mt-3 text-center text-sm text-muted-foreground">{word.phonetic}</p>
          <div className="mt-12 grid gap-3">
            {options.map((option) => (
              <Button
                key={option}
                variant="outline"
                className="h-auto min-h-14 justify-start rounded-xl bg-card px-5 py-4 text-left font-normal"
                onClick={() => onAnswer(option)}
              >
                {option}
              </Button>
            ))}
          </div>
        </section>
      </main>
    );
  }

  if (step === 'result') {
    return (
      <main className="grid min-h-screen place-items-center bg-background px-5">
        <section className="w-full max-w-lg rounded-[26px] border border-border bg-card p-8 text-center sm:p-10">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-secondary text-primary">
            <Gauge className="size-5" />
          </span>
          <p className="mt-6 text-sm text-muted-foreground">摸底完成</p>
          <h1 className="mt-2 font-heading text-3xl font-semibold">
            认识 {knownCount} / {words.length} 个
          </h1>
          <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-muted-foreground">
            已认识的词会延后复习，其余单词将从今天开始安排。
          </p>
          <Button className="mt-8 h-11 rounded-full px-6" onClick={onComplete}>
            进入今日任务
            <ArrowRight data-icon="inline-end" />
          </Button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background px-5 py-8 text-foreground">
      <header className="mx-auto flex max-w-4xl items-center justify-between">
        <span className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">词</span>
          <span className="font-semibold tracking-[0.12em]">词序</span>
        </span>
        <span className="text-xs text-muted-foreground">数据仅保存在当前设备</span>
      </header>
      <section className="mx-auto mt-[clamp(3rem,10vh,6.5rem)] max-w-4xl">
        <div className="grid gap-10 lg:grid-cols-[1fr_0.95fr] lg:items-start">
          <div>
            <Badge variant="outline" className="font-normal">开始前花 1 分钟设置</Badge>
            <h1 className="mt-5 font-heading text-[clamp(2.8rem,7vw,4.7rem)] font-semibold leading-[1.06] tracking-[-0.055em]">
              每天少背一点，
              <br />
              但按时回来。
            </h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-muted-foreground">
              词序会把新词、到期词和错词排成一份清楚的每日任务。没有账号、没有云同步，也没有多余功能。
            </p>
          </div>
          <div className="rounded-[22px] border border-border bg-card p-6 sm:p-7">
            <div>
              <p className="text-sm font-medium">准备哪一场考试？</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {(['cet4', 'cet6'] as WordLevel[]).map((item) => (
                  <Button
                    key={item}
                    variant="outline"
                    className={cn(
                      'h-12 rounded-xl font-normal',
                      level === item && 'border-primary bg-secondary font-medium text-primary',
                    )}
                    onClick={() => onLevelChange(item)}
                  >
                    {item === 'cet4' ? '大学英语四级' : '大学英语六级'}
                  </Button>
                ))}
              </div>
            </div>
            <div className="mt-7">
              <p className="text-sm font-medium">每天学习多少个新词？</p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {[10, 20, 30].map((item) => (
                  <Button
                    key={item}
                    variant="outline"
                    className={cn(
                      'h-11 rounded-xl font-normal',
                      goal === item && 'border-primary bg-secondary font-medium text-primary',
                    )}
                    onClick={() => onGoalChange(item)}
                  >
                    {item} 个
                  </Button>
                ))}
              </div>
            </div>
            <Button className="mt-8 h-11 w-full rounded-xl" onClick={onBegin}>
              开始 5 词摸底
              <ArrowRight data-icon="inline-end" />
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}

function SettingsDialog({
  open,
  study,
  onOpenChange,
  onStudyChange,
  onExport,
  onImport,
  onReset,
}: {
  open: boolean;
  study: StudyState;
  onOpenChange(open: boolean): void;
  onStudyChange(state: StudyState | ((current: StudyState) => StudyState)): void;
  onExport(): void;
  onImport(): void;
  onReset(): void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl">学习设置</DialogTitle>
          <DialogDescription>设置会自动保存在当前浏览器。</DialogDescription>
        </DialogHeader>
        <div className="space-y-6 py-2">
          <div>
            <p className="mb-2 text-sm font-medium">当前词库</p>
            <div className="grid grid-cols-2 gap-2">
              {(['cet4', 'cet6'] as WordLevel[]).map((level) => (
                <Button
                  key={level}
                  variant="outline"
                  className={cn(
                    'h-10 font-normal',
                    study.level === level && 'border-primary bg-secondary font-medium text-primary',
                  )}
                  onClick={() => onStudyChange((current) => ({ ...current, level }))}
                >
                  {levelLabel(level)}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">每日新词</p>
            <div className="grid grid-cols-3 gap-2">
              {[10, 20, 30].map((goal) => (
                <Button
                  key={goal}
                  variant="outline"
                  className={cn(
                    'h-10 font-normal',
                    study.dailyGoal === goal && 'border-primary bg-secondary font-medium text-primary',
                  )}
                  onClick={() =>
                    onStudyChange((current) => ({ ...current, dailyGoal: goal }))
                  }
                >
                  {goal} 个
                </Button>
              ))}
            </div>
          </div>
          <div className="border-t border-border pt-5">
            <p className="mb-2 text-sm font-medium">本地备份</p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={onExport}>
                <Download data-icon="inline-start" />
                导出记录
              </Button>
              <Button variant="outline" onClick={onImport}>
                <Upload data-icon="inline-start" />
                导入记录
              </Button>
            </div>
          </div>
          <button className="text-sm text-destructive hover:underline" onClick={onReset}>
            清空全部学习记录
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
