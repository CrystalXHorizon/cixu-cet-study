'use client';

import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  ChevronRight,
  CircleAlert,
  Download,
  Gauge,
  Headphones,
  LayoutGrid,
  Play,
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
import { ExamSessionSelect } from '@/components/exam-session-select';
import { SentencePicker } from '@/components/sentence-picker';
import { ListeningPractice } from '@/components/listening-practice';
import { PlaybackNotice } from '@/components/playback-notice';
import { StudyCalendar } from '@/components/study-calendar';
import { preparePronunciation } from '@/lib/pronunciation';
import { examPlanningDate, examSchedule, examSessionLabel, nextExamSession, normalizeExamSession } from '@/lib/exam-session';
import { greeting, normalizeNickname, progressPercent, restoreListeningHistory, type ListeningDay } from '@/lib/study-dashboard';
import { DEFAULT_AUDIO, restoreAudioPreferences, speechPlayer, type AudioPreferences } from '@/lib/speech-player';
import { buildListeningQueue, type ListeningItem } from '@/lib/listening-queue';
import { normalizeToken, restoreSentenceMarks, saveSentenceMarks, sentenceMarkKey, type ReviewRecord, type SentenceMark } from '@/lib/sentence-words';
import { cn } from '@/lib/utils';
import {
  loadWords,
  WORD_COUNTS,
  type SentenceExample,
  type Word,
  type WordLevel,
} from '@/lib/words';

type View = 'today' | 'words' | 'mistakes' | 'progress' | 'review' | 'listening';
type WordFilter = 'all' | 'new' | 'learning' | 'mastered';
type SessionMode = 'new' | 'review' | 'mistakes';
type LearningPhase = 'listen' | 'study' | 'recall' | 'review-listen' | 'review-context';

type SessionItem = {
  wordId: string;
  phase: LearningPhase;
  exampleIndex?: number;
  retry?: boolean;
};

type DayRecord = {
  reviewed: number;
  correct: number;
  learned?: number;
};

type StudyState = {
  version: 2;
  initialized: boolean;
  nickname: string;
  audio: AudioPreferences;
  listeningHistory: Record<string, ListeningDay>;
  level: WordLevel;
  examDate: string;
  gaokaoScore: number;
  gaokaoFullScore: number;
  reviews: Record<string, ReviewRecord>;
  mistakes: string[];
  saved: string[];
  sentenceMarks: SentenceMark[];
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
  execute(input: unknown): Record<string, unknown>;
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

const STORAGE_KEY = 'cixu-study-state-v2';

const EMPTY_STATE: StudyState = {
  version: 2,
  initialized: false,
  nickname: '',
  audio: DEFAULT_AUDIO,
  listeningHistory: {},
  level: 'cet6',
  examDate: nextExamSession(),
  gaokaoScore: 100,
  gaokaoFullScore: 150,
  reviews: {},
  mistakes: [],
  saved: [],
  sentenceMarks: [],
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

function daysUntil(dateKey: string) {
  const target = new Date(`${dateKey}T12:00:00`);
  const today = new Date(`${dayKey()}T12:00:00`);
  if (!Number.isFinite(target.getTime())) return 0;
  return Math.max(0, Math.ceil((target.getTime() - today.getTime()) / 86_400_000));
}

function studyPlan(
  state: Pick<StudyState, 'level' | 'examDate' | 'gaokaoScore' | 'gaokaoFullScore'>,
  totalWords: number = state.level === 'cet4' ? WORD_COUNTS.cet4 : WORD_COUNTS.cet6Total,
  remainingWords: number = totalWords,
) {
  const daysLeft = daysUntil(examPlanningDate(state.examDate));
  const scoreRate = state.gaokaoFullScore > 0 ? state.gaokaoScore / state.gaokaoFullScore : 0.67;
  const foundationFactor = scoreRate < 0.55 ? 0.78 : scoreRate < 0.7 ? 0.68 : scoreRate < 0.83 ? 0.56 : 0.44;
  const estimatedGap = Math.min(remainingWords, Math.round(totalWords * foundationFactor));
  const consolidationDays = daysLeft >= 90 ? 21 : daysLeft >= 45 ? 14 : Math.max(5, Math.round(daysLeft * 0.25));
  const learningDays = Math.max(1, daysLeft - consolidationDays);
  const rawDaily = Math.ceil(estimatedGap / learningDays);
  const phase =
    daysLeft > 120 ? '基础期' : daysLeft > 60 ? '主攻期' : daysLeft > 30 ? '强化期' : daysLeft > 14 ? '冲刺期' : '回收期';
  const cap = daysLeft > 60 ? 35 : daysLeft > 30 ? 30 : daysLeft > 14 ? 20 : 10;
  const minimum = daysLeft > 14 ? 10 : 5;
  const dailyNew = Math.max(minimum, Math.min(cap, Math.ceil(rawDaily / 5) * 5));
  return { daysLeft, phase, dailyNew, estimatedGap, consolidationDays };
}

function prioritizeNewWords(
  words: Word[],
  state: Pick<StudyState, 'gaokaoScore' | 'gaokaoFullScore'>,
) {
  const scoreRate = state.gaokaoFullScore > 0
    ? state.gaokaoScore / state.gaokaoFullScore
    : 0.67;
  const startingRank = scoreRate < 0.55 ? 900 : scoreRate < 0.7 ? 2500 : scoreRate < 0.83 ? 5000 : 8000;
  return [...words].sort((left, right) => {
    const leftDistance = Math.abs(left.rank - startingRank);
    const rightDistance = Math.abs(right.rank - startingRank);
    return leftDistance - rightDistance || left.rank - right.rank;
  });
}

function wordStatus(record?: ReviewRecord): WordFilter {
  if (!record) return 'new';
  if (record.interval >= 21 && record.correctStreak >= 2) return 'mastered';
  return 'learning';
}

function levelLabel(level: WordLevel) {
  return level === 'cet4' ? '四级词汇' : '六级词汇';
}

function playWordPronunciation(word: string) {
  return speechPlayer.playWord(word);
}

function speakSentence(sentence: string) {
  void speechPlayer.play(sentence);
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
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [wordFilter, setWordFilter] = useState<WordFilter>('all');
  const [setupLevel, setSetupLevel] = useState<WordLevel>('cet6');
  const [setupNickname, setSetupNickname] = useState('');
  const [listeningItems, setListeningItems] = useState<ListeningItem[]>([]);
  const [setupExamDate, setSetupExamDate] = useState(EMPTY_STATE.examDate);
  const [setupScore, setSetupScore] = useState(100);
  const [setupFullScore, setSetupFullScore] = useState(150);
  const [sessionItems, setSessionItems] = useState<SessionItem[]>([]);
  const [sessionIndex, setSessionIndex] = useState(0);
  const [sessionMode, setSessionMode] = useState<SessionMode>('new');
  const [revealed, setRevealed] = useState(false);
  const [sessionStats, setSessionStats] = useState({ reviewed: 0, correct: 0 });
  const [sessionDone, setSessionDone] = useState(false);
  const [notice, setNotice] = useState('');
  const [activeWords, setActiveWords] = useState<Word[]>([]);
  const [loadedLevel, setLoadedLevel] = useState<WordLevel | null>(null);
  const [failedLevel, setFailedLevel] = useState<WordLevel | null>(null);
  const [wordLoadAttempt, setWordLoadAttempt] = useState(0);
  const importRef = useRef<HTMLInputElement>(null);
  const stateRef = useRef(study);
  const wordsRef = useRef(activeWords);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as StudyState;
        if (parsed.version === 2) setStudy({ ...parsed, nickname: normalizeNickname(parsed.nickname), audio: restoreAudioPreferences(parsed.audio), listeningHistory: restoreListeningHistory(parsed.listeningHistory), examDate: normalizeExamSession(parsed.examDate), sentenceMarks: restoreSentenceMarks(parsed.sentenceMarks) });
      } else {
        const legacy = window.localStorage.getItem('cixu-study-state-v1');
        if (legacy) {
          const parsed = JSON.parse(legacy) as Omit<StudyState, 'version' | 'examDate' | 'gaokaoScore' | 'gaokaoFullScore'>;
          setStudy({
            ...parsed,
            version: 2,
            examDate: EMPTY_STATE.examDate,
            gaokaoScore: EMPTY_STATE.gaokaoScore,
            gaokaoFullScore: EMPTY_STATE.gaokaoFullScore,
            sentenceMarks: [],
            nickname: '',
            audio: DEFAULT_AUDIO,
            listeningHistory: {},
          });
        }
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

  useEffect(() => { speechPlayer.preferences = study.audio; }, [study.audio]);
  useEffect(() => () => speechPlayer.stop(), [view]);

  useEffect(() => {
    wordsRef.current = activeWords;
  }, [activeWords]);

  useEffect(() => {
    if (!ready || !study.initialized) return;
    let cancelled = false;
    void loadWords(study.level)
      .then((words) => {
        if (cancelled) return;
        setActiveWords(words);
        setLoadedLevel(study.level);
        setFailedLevel(null);
      })
      .catch(() => {
        if (cancelled) return;
        setFailedLevel(study.level);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, study.initialized, study.level, wordLoadAttempt]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(''), 2400);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const wordMap = useMemo(
    () => new Map(activeWords.map((item) => [item.id, item])),
    [activeWords],
  );
  const sentenceDictionary = useMemo(
    () => new Map(activeWords.map((word) => [normalizeToken(word.word), word])),
    [activeWords],
  );
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
  const plan = studyPlan(study, activeWords.length, newWords.length);
  const todayNewGoal = Math.min(plan.dailyNew, newWords.length);
  const todayTarget = Math.max(1, dueWords.length + todayNewGoal);
  const todayProgress = Math.min(
    100,
    Math.round((todayRecord.reviewed / todayTarget) * 100),
  );

  function sessionQueue(mode: SessionMode, source = study, pool = activeWords): SessionItem[] {
    if (mode === 'mistakes') {
      return source.mistakes
        .filter((id) => pool.some((word) => word.id === id))
        .slice(0, 15)
        .map((wordId, index) => {
          const word = pool.find((item) => item.id === wordId);
          const record = source.reviews[wordId];
          const attempts = (record?.correct ?? 0) + (record?.wrong ?? 0);
          return {
            wordId,
            exampleIndex: word?.examples.length ? attempts % word.examples.length : 0,
            phase: index % 3 === 0 ? 'review-listen' : 'review-context',
          };
        });
    }
    if (mode === 'review') {
      return pool
        .filter((word) => {
          const record = source.reviews[word.id];
          return record && record.due <= dayKey();
        })
        .slice(0, 20)
        .map((word, index) => {
          const record = source.reviews[word.id];
          const attempts = (record?.correct ?? 0) + (record?.wrong ?? 0);
          return {
            wordId: word.id,
            exampleIndex: word.examples.length ? attempts % word.examples.length : 0,
            phase: index % 3 === 0 ? 'review-listen' : 'review-context',
          };
        });
    }
    const groupSize = 5;
    const fresh = prioritizeNewWords(pool, source)
      .filter((word) => !source.reviews[word.id])
      .slice(0, Math.min(groupSize, studyPlan(source, pool.length).dailyNew));
    return [
      ...fresh.map((word) => ({ wordId: word.id, phase: 'listen' as const, exampleIndex: 0 })),
      ...fresh.map((word) => ({ wordId: word.id, phase: 'study' as const, exampleIndex: 0 })),
      ...fresh.map((word) => ({
        wordId: word.id,
        phase: 'recall' as const,
        exampleIndex: word.examples.length > 1 ? 1 : 0,
      })),
    ];
  }

  function startSession(mode: SessionMode) {
    const queue = sessionQueue(mode);
    if (queue.length === 0) {
      setNotice(
        mode === 'mistakes'
          ? '薄弱词已经全部清空'
          : mode === 'review'
            ? '今天没有到期词'
            : '当前词库的新词已经学完',
      );
      return false;
    }
    setSessionMode(mode);
    setSessionItems(queue);
    setSessionIndex(0);
    setSessionStats({ reviewed: 0, correct: 0 });
    setSessionDone(false);
    setRevealed(false);
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
            const pool = wordsRef.current;
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
          name: 'start_vocabulary_session',
          title: '开始背词',
          description: '打开新词学习、到期复习或薄弱词巩固，并生成当前学习队列。',
          inputSchema: {
            type: 'object',
            properties: {
              mode: { type: 'string', enum: ['new', 'review', 'mistakes'] },
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
            if (mode !== 'new' && mode !== 'review' && mode !== 'mistakes') {
              throw new Error('mode 必须是 new、review 或 mistakes');
            }
            const current = stateRef.current;
            if (!current.initialized) {
              throw new Error('请先完成首次词汇设置');
            }
            const pool = wordsRef.current;
            if (pool.length === 0) throw new Error('词库仍在加载，请稍后再试');
            const queue = sessionQueue(mode, current, pool);
            if (queue.length === 0) {
              throw new Error(
                mode === 'mistakes'
                  ? '当前没有薄弱词'
                  : mode === 'review'
                    ? '今天没有到期词'
                    : '当前词库没有未学新词',
              );
            }
            setSessionMode(mode);
            setSessionItems(queue);
            setSessionIndex(0);
            setSessionStats({ reviewed: 0, correct: 0 });
            setSessionDone(false);
            setRevealed(false);
            setView('review');
            return { mode, count: queue.length, status: 'started' };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => undefined);

    return () => lifecycle.abort();
  }, [ready]);

  function completeOnboarding() {
    setStudy({
      ...EMPTY_STATE,
      initialized: true,
      nickname: normalizeNickname(setupNickname),
      level: setupLevel,
      examDate: setupExamDate,
      gaokaoScore: Math.max(0, setupScore),
      gaokaoFullScore: Math.max(1, setupFullScore),
    });
    setView('today');
  }

  function startListening() {
    const items = buildListeningQueue(activeWords, study.reviews, study.mistakes, study.sentenceMarks, dayKey());
    if (!items.length) { setNotice('暂时没有可用例句'); return; }
    speechPlayer.stop();
    setListeningItems(items);
    setView('listening');
  }

  function recordListening(understood: boolean) {
    setStudy((current) => {
      const date = dayKey();
      const previous = current.listeningHistory[date] ?? { completed: 0, understood: 0 };
      return {
        ...current,
        ...updateStreak(current),
        listeningHistory: {
          ...current.listeningHistory,
          [date]: { completed: previous.completed + 1, understood: previous.understood + (understood ? 1 : 0) },
        },
      };
    });
  }

  function recordGrade(word: Word, grade: 0 | 1 | 2) {
    setStudy((current) => {
      const previous = current.reviews[word.id];
      const previousInterval = previous?.interval ?? 0;
      const correctStreak =
        grade === 2
          ? (previous?.correctStreak ?? 0) + 1
          : grade === 1
            ? Math.max(0, (previous?.correctStreak ?? 0) - 1)
            : 0;
      const reviewSteps = [1, 3, 7, 14, 21, 30, 60];
      const interval =
        grade === 0
          ? 1
          : grade === 1
            ? Math.max(1, Math.round(previousInterval * 0.65) || 1)
            : reviewSteps[Math.min(correctStreak - 1, reviewSteps.length - 1)];
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
            learned: (history.learned ?? 0) + (previous?.lastReviewed ? 0 : 1),
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
    if (sessionIndex >= sessionItems.length - 1) {
      setSessionDone(true);
      return;
    }
    setSessionIndex((current) => current + 1);
    setRevealed(false);
  }

  function gradeRecall(word: Word, grade: 0 | 1 | 2) {
    recordGrade(word, grade);
    const needsRetry = grade < 2;
    if (needsRetry) {
      setSessionItems((current) => {
        const next = [...current];
        const insertAt = Math.min(sessionIndex + (grade === 0 ? 4 : 7), next.length);
        const currentExample = current[sessionIndex]?.exampleIndex ?? 0;
        next.splice(insertAt, 0, {
          wordId: word.id,
          phase: 'recall',
          exampleIndex: word.examples.length > 1
            ? (currentExample + 1) % word.examples.length
            : 0,
          retry: true,
        });
        return next;
      });
    }
    if (sessionIndex >= sessionItems.length - 1 && !needsRetry) {
      setSessionDone(true);
    } else {
      setSessionIndex((current) => current + 1);
      setRevealed(false);
    }
  }

  useEffect(() => {
    if (view !== 'review' || sessionDone) return;
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey
        || target.closest('input, textarea, select, button, a, [contenteditable="true"], [role="dialog"], [role="combobox"]')) return;
      const item = sessionItems[sessionIndex];
      const word = wordMap.get(item?.wordId);
      if (!word) return;
      if (!revealed && event.code === 'Space') {
        event.preventDefault();
        setRevealed(true);
      } else if (revealed && ['recall', 'review-listen', 'review-context'].includes(item.phase)) {
        if (event.key === '1') gradeRecall(word, 0);
        if (event.key === '2') gradeRecall(word, 1);
        if (event.key === '3') gradeRecall(word, 2);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [revealed, sessionDone, sessionItems, sessionIndex, view, wordMap]);

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
        if (typeof reader.result !== 'string') throw new Error('invalid');
        const parsed = JSON.parse(reader.result) as StudyState;
        if (parsed.version !== 2 || !parsed.reviews || !parsed.history) {
          throw new Error('invalid');
        }
        setStudy({ ...parsed, nickname: normalizeNickname(parsed.nickname), audio: restoreAudioPreferences(parsed.audio), listeningHistory: restoreListeningHistory(parsed.listeningHistory), examDate: normalizeExamSession(parsed.examDate), sentenceMarks: restoreSentenceMarks(parsed.sentenceMarks) });
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
    setSetupNickname('');
    setSetupExamDate(EMPTY_STATE.examDate);
    setSetupScore(100);
    setSetupFullScore(150);
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
        nickname={setupNickname}
        onNicknameChange={setSetupNickname}
        level={setupLevel}
        examDate={setupExamDate}
        score={setupScore}
        fullScore={setupFullScore}
        onLevelChange={setSetupLevel}
        onExamDateChange={setSetupExamDate}
        onScoreChange={setSetupScore}
        onFullScoreChange={setSetupFullScore}
        onComplete={completeOnboarding}
      />
    );
  }

  if (loadedLevel !== study.level) {
    return (
      <main className="grid min-h-screen place-items-center bg-background px-5">
        <div className="max-w-sm text-center">
          {failedLevel === study.level ? (
            <>
              <CircleAlert className="mx-auto size-6 text-destructive" />
              <h1 className="mt-4 font-heading text-xl font-semibold">词库没有加载成功</h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">检查网络后重试，学习记录不会受影响。</p>
              <Button
                className="mt-5 rounded-full px-5"
                onClick={() => {
                  setFailedLevel(null);
                  setWordLoadAttempt((value) => value + 1);
                }}
              >
                重新加载
              </Button>
            </>
          ) : (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span className="size-2 animate-pulse rounded-full bg-primary" />
              正在载入 {levelLabel(study.level)}
            </div>
          )}
        </div>
      </main>
    );
  }

  const currentItem = sessionItems[sessionIndex];
  const currentWord = wordMap.get(currentItem?.wordId);
  const currentExample = currentWord?.examples[currentItem?.exampleIndex ?? 0] ?? currentWord?.examples[0];

  if (view === 'listening') {
    return <ListeningPractice
      items={listeningItems}
      preferences={study.audio}
      onPreferences={(audio) => setStudy((current) => ({ ...current, audio }))}
      dictionary={sentenceDictionary}
      marks={study.sentenceMarks}
      onMarks={(example, marks) => setStudy((current) => saveSentenceMarks(current, example, marks, dayKey()))}
      onComplete={recordListening}
      onExit={() => setView('today')}
    />;
  }

  if (view === 'review' && currentWord && currentItem && currentExample) {
    return (
      <ReviewSession
        key={`${sessionMode}-${sessionIndex}`}
        word={currentWord}
        example={currentExample}
        phase={currentItem.phase}
        retry={Boolean(currentItem.retry)}
        sessionMode={sessionMode}
        index={sessionIndex}
        total={sessionItems.length}
        revealed={revealed}
        stats={sessionStats}
        done={sessionDone}
        onReveal={() => setRevealed(true)}
        onGrade={(grade) => gradeRecall(currentWord, grade)}
        onAdvance={advanceSession}
        onSpeak={() => void playWordPronunciation(currentWord.word)}
        onListen={() => speakSentence(currentExample.english)}
        onExit={() => setView('today')}
        sentenceDictionary={sentenceDictionary}
        sentenceMarks={study.sentenceMarks}
        onSentenceMarks={(example, selected) => setStudy((current) => saveSentenceMarks(current, example, selected, dayKey()))}
      />
    );
  }

  return (
    <main className="min-h-screen bg-background pb-20 text-foreground lg:pb-0">
      <AppHeader
        level={study.level}
        streak={study.streak}
        onCalendar={() => setCalendarOpen(true)}
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
              plan={plan}
              onStartNew={() => startSession('new')}
              onStartReview={() => startSession('review')}
              onMistakes={() => startSession('mistakes')}
              onExamDateChange={(examDate) => setStudy((current) => ({ ...current, examDate }))}
              onStartListening={startListening}
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
              onSpeak={(word) => void playWordPronunciation(word)}
            />
          )}
          {view === 'mistakes' && (
            <MistakeBook
              words={study.mistakes
                .map((id) => wordMap.get(id))
                .filter((word): word is Word => Boolean(word))}
              reviews={study.reviews}
              onStart={() => startSession('mistakes')}
              onSpeak={(word) => void playWordPronunciation(word)}
              sentenceMarks={study.sentenceMarks}
              onRemoveMark={(mark) => setStudy((current) => saveSentenceMarks(
                current, mark.example,
                current.sentenceMarks.filter((item) => item.example.english === mark.example.english && sentenceMarkKey(item) !== sentenceMarkKey(mark)),
                dayKey(),
              ))}
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

      <PlaybackNotice />
      {calendarOpen && <StudyCalendar open={calendarOpen} onOpenChange={setCalendarOpen} history={study.history} listening={study.listeningHistory} reviews={study.reviews} words={activeWords} dailyNew={plan.dailyNew} examSession={study.examDate} consolidationDays={plan.consolidationDays} onStart={() => { setCalendarOpen(false); setView('today'); }} />}
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
        <output
          className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-sm text-background shadow-lg lg:bottom-7"
        >
          {notice}
        </output>
      )}
    </main>
  );
}

function AppHeader({
  level,
  streak,
  onSettings,
  onCalendar,
}: {
  level: WordLevel;
  streak: number;
  onSettings(): void;
  onCalendar: () => void;
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
          <button type="button" onClick={onCalendar} aria-label={`连续学习 ${streak} 天，查看学习日程`} className="rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium transition-colors hover:border-primary hover:bg-secondary focus-visible:outline-2 focus-visible:outline-primary">
            连续 {streak} 天
          </button>
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
  plan,
  onStartNew,
  onStartReview,
  onStartListening,
  onMistakes,
  onExamDateChange,
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
  plan: ReturnType<typeof studyPlan>;
  onStartNew(): void;
  onStartReview(): void;
  onStartListening: () => void;
  onMistakes(): void;
  onExamDateChange: (session: string) => void;
}) {
  const correctRate =
    todayRecord.reviewed > 0
      ? Math.round((todayRecord.correct / todayRecord.reviewed) * 100)
      : 0;
  const newBatchCount = Math.min(5, newCount);
  const groups = Math.max(1, Math.ceil(plan.dailyNew / 5));
  const primaryIsReview = dueCount > 0;
  const [examDialogOpen, setExamDialogOpen] = useState(false);
  const [draftSession, setDraftSession] = useState(study.examDate);
  const schedule = examSchedule(study.examDate);
  const learned = todayRecord.learned ?? 0;
  const newTarget = Math.min(plan.dailyNew, newCount + learned);
  const weakWords = activeWords.filter((word) => study.mistakes.includes(word.id) || study.reviews[word.id]?.wrong > 0);
  const weakRemaining = weakWords.filter((word) => study.mistakes.includes(word.id)).length;
  const weakRecovered = weakWords.length - weakRemaining;

  return (
    <>
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-sm text-muted-foreground">
            <span className="mr-3 text-foreground">{greeting(study.nickname)}</span>
            {new Intl.DateTimeFormat('zh-CN', {
              month: 'long',
              day: 'numeric',
              weekday: 'long',
            }).format(new Date())}
          </p>
          <h1 className="font-heading text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
            {primaryIsReview ? '先把该复习的记牢。' : '今天从五个新词开始。'}
          </h1>
        </div>
        <div className="text-sm leading-6 text-muted-foreground sm:text-right">
          <p>{schedule.confirmed ? `本次${study.level === 'cet4' ? '四级' : '六级'}笔试：${formatExamDate(schedule.date)}` : `${examSessionLabel(study.examDate)}场次 · 日期待公布`}</p>
          <p className="text-xs">{plan.phase} · 距目标{schedule.confirmed ? '考试' : '场次约'} {plan.daysLeft} 天</p>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.85fr)]">
        <article className="relative overflow-hidden rounded-[22px] bg-primary p-6 text-primary-foreground sm:p-8">
          <div className="absolute -right-12 -top-12 size-48 rounded-full border border-white/10" />
          <div className="absolute -right-2 top-20 size-24 rounded-full border border-white/10" />
          <div className="relative">
            <div className="mb-12 flex items-center gap-2 text-sm text-primary-foreground/70">
              {primaryIsReview ? <RotateCcw className="size-4" /> : <Headphones className="size-4" />}
              {primaryIsReview ? '第一步 · 到期复习' : '第一步 · 新词学习'}
            </div>
            <p className="mb-3 text-sm text-primary-foreground/65">
              {primaryIsReview ? '今天到期' : '一组只背'}
            </p>
            <h2 className="font-heading text-[clamp(2.7rem,7vw,5rem)] font-semibold leading-none tracking-[-0.055em]">
              {primaryIsReview ? `${dueCount} 个` : `${newBatchCount} 个`}
            </h2>
            <p className="mt-5 max-w-lg text-sm leading-6 text-primary-foreground/72">
              {primaryIsReview
                ? '到期词优先，用听句子和语境回忆把记忆重新拉回来。'
                : '先听例句，再看词义，最后回到句子里主动想一次。'}
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Button
                size="lg"
                className="h-11 rounded-full bg-[#f6f0e2] px-5 text-[#173e34] hover:bg-white"
                onClick={primaryIsReview ? onStartReview : onStartNew}
              >
                {primaryIsReview ? '开始到期复习' : '背第一组新词'}
                <ArrowRight data-icon="inline-end" />
              </Button>
              <span className="text-sm text-primary-foreground/65">
                {primaryIsReview ? '先复习，再学新词' : '约 4 分钟'}
              </span>
            </div>
          </div>
        </article>

        <article className="rounded-[22px] border border-border bg-card p-6 sm:p-7">
          <div className="mb-7 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">备考节奏</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight">{plan.phase}</p>
            </div>
            <Button size="icon" variant="ghost" className="size-10 rounded-full bg-secondary text-primary hover:bg-secondary/70" aria-label="修改考试场次" title="修改考试场次" onClick={() => { setDraftSession(study.examDate); setExamDialogOpen(true); }}>
              <CalendarDays className="size-5" />
            </Button>
          </div>
          <div className="rounded-xl bg-secondary/45 p-4">
            <p className="text-sm text-muted-foreground">目标考试场次</p>
            <p className="mt-2 font-medium">{examSessionLabel(study.examDate)}</p>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              每天建议新学 <strong className="font-semibold text-foreground">{plan.dailyNew} 个</strong>，分 {groups} 组；考前预留 {plan.consolidationDays} 天只做回收与真题语境。
            </p>
            <ExamScheduleNote session={study.examDate} />
          </div>
          <div className="mt-5 flex items-center justify-between text-xs text-muted-foreground">
            <span>今日总进度</span>
            <span>{todayRecord.reviewed} / {todayTarget}</span>
          </div>
          <Progress
            value={todayProgress}
            className="mt-2 [&_[data-slot=progress-track]]:h-1.5"
          />
        </article>
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <article className="rounded-2xl border border-border bg-card p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-muted-foreground">到期复习</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight">{dueCount} 个</p>
            </div>
            <span className="grid size-9 place-items-center rounded-full bg-muted text-muted-foreground">
              <RotateCcw className="size-4" />
            </span>
          </div>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            听完整句或结合上下文回忆，不做孤立的近义词配对。
          </p>
          <Button variant="outline" className="mt-5 w-full" disabled={dueCount === 0} onClick={onStartReview}>
            {dueCount > 0 ? '复习到期词' : '今天已清空'}
          </Button>
        </article>

        <article className="rounded-2xl border border-border bg-card p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-muted-foreground">新词背诵</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight">{plan.dailyNew} 个</p>
            </div>
            <Button size="icon" variant="ghost" className="size-9 rounded-full bg-secondary text-primary hover:bg-secondary/70" aria-label="进入听力专项训练" title="进入听力专项训练" onClick={onStartListening}>
              <Headphones className="size-4" />
            </Button>
          </div>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            每组 5 个：先听句子，再理解词义，最后换一句话主动回忆。
          </p>
          <Button className="mt-5 w-full" disabled={newCount === 0} onClick={onStartNew}>
            背一组新词
          </Button>
        </article>
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-3">
        <article className="rounded-2xl border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">今天新学</p>
          <p className="mt-3 text-2xl font-semibold tracking-tight">
            {todayRecord.learned ?? 0}{' '}
            <span className="text-sm font-normal text-muted-foreground">个词</span>
          </p>
          <Progress aria-label="今日新词完成进度" value={progressPercent(learned, newTarget)} className="mt-4 [&_[data-slot=progress-track]]:h-1.5" />
          <p className="mt-2 text-xs text-muted-foreground">今日目标 {learned} / {newTarget} 词</p>
        </article>
        <button
          className="group rounded-2xl border border-border bg-card p-5 text-left transition-colors hover:bg-secondary/45"
          onClick={onMistakes}
        >
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">需要再记</p>
            <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </div>
          <p className="mt-3 text-2xl font-semibold tracking-tight">
            {weakRemaining}{' '}
            <span className="text-sm font-normal text-muted-foreground">个词</span>
          </p>
          <Progress aria-label="薄弱词巩固进度" value={progressPercent(weakRecovered, weakWords.length)} className="mt-4 [&_[data-slot=progress-track]]:h-1.5" />
          <p className="mt-2 text-xs text-muted-foreground">{weakWords.length ? `已巩固 ${weakRecovered} / ${weakWords.length} 个薄弱词` : '暂无待巩固词'}</p>
        </button>
        <article className="rounded-2xl border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">词库进度</p>
          <p className="mt-3 text-2xl font-semibold tracking-tight">
            {Math.round(progressPercent(masteredCount, activeWords.length))}%{' '}
            <span className="text-sm font-normal text-muted-foreground">已稳定 {masteredCount}</span>
          </p>
          <Progress aria-label="词库掌握进度" value={progressPercent(masteredCount, activeWords.length)} className="mt-4 [&_[data-slot=progress-track]]:h-1.5" />
          <p className="mt-2 text-xs text-muted-foreground">已稳定 {masteredCount} / {activeWords.length} 词</p>
        </article>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-5 text-xs text-muted-foreground">
        <span>今日回忆正确率 {correctRate || '—'}{correctRate ? '%' : ''}</span>
        <span>正在学习 {learningCount} 个</span>
        <span>今日精听 {study.listeningHistory[dayKey()]?.completed ?? 0} 句</span>
        <span>记录仅保存在当前浏览器</span>
      </div>
      <Dialog open={examDialogOpen} onOpenChange={setExamDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>修改考试场次</DialogTitle>
            <DialogDescription>保存后重新安排每日背词量，已有学习记录不会改变。</DialogDescription>
          </DialogHeader>
          <label htmlFor="today-exam-session" className="text-sm font-medium">目标场次</label>
          <ExamSessionSelect id="today-exam-session" value={draftSession} onChange={setDraftSession} />
          <ExamScheduleNote session={draftSession} />
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setExamDialogOpen(false)}>取消</Button>
            <Button onClick={() => { onExamDateChange(draftSession); setExamDialogOpen(false); }}>保存场次</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function formatExamDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return `${year} 年 ${month} 月 ${day} 日`;
}

function ExamScheduleNote({ session }: { session: string }) {
  const schedule = examSchedule(session);
  return <p className="mt-2 text-xs leading-5 text-muted-foreground">{schedule.confirmed ? <>笔试日期：{formatExamDate(schedule.date)}。<a href={schedule.source} target="_blank" rel="noreferrer" className="ml-1 underline underline-offset-4 hover:text-primary">官方通知</a></> : '具体考试日期待公布；背词计划暂按所选月份中旬估算。'}</p>;
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
  const [visibleState, setVisibleState] = useState({ key: '', count: 80 });
  const filtered = words.filter((word) => {
    const query = search.trim().toLocaleLowerCase();
    const matchesSearch =
      !query ||
      word.word.toLocaleLowerCase().includes(query) ||
      word.meaning.includes(query) ||
      word.examples.some(
        (example) =>
          example.english.toLocaleLowerCase().includes(query) ||
          example.chinese.includes(query),
      );
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

  const visibleKey = `${filter}:${search}`;
  const visibleCount = visibleState.key === visibleKey ? visibleState.count : 80;
  const visibleWords = filtered.slice(0, visibleCount);

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
            placeholder="搜索单词、释义或例句"
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
          visibleWords.map((word, index) => {
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
                      onPointerEnter={() => void preparePronunciation(word.word).catch(() => {})}
                      onFocus={() => void preparePronunciation(word.word).catch(() => {})}
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
                  <p className="mt-1.5 line-clamp-1 text-xs text-muted-foreground">{word.examples[0]?.english}</p>
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
      {visibleCount < filtered.length && (
        <div className="mt-4 text-center">
          <Button
            variant="outline"
            className="rounded-full px-5"
            onClick={() => setVisibleState({ key: visibleKey, count: visibleCount + 80 })}
          >
            继续显示 · 还有 {filtered.length - visibleCount} 词
          </Button>
        </div>
      )}
    </>
  );
}

function MistakeBook({
  words,
  reviews,
  onStart,
  onSpeak,
  sentenceMarks,
  onRemoveMark,
}: {
  words: Word[];
  reviews: Record<string, ReviewRecord>;
  onStart(): void;
  onSpeak(word: string): void;
  sentenceMarks: SentenceMark[];
  onRemoveMark: (mark: SentenceMark) => void;
}) {
  return (
    <>
      <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-sm text-muted-foreground">回看答错的词和句中标记</p>
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
      {sentenceMarks.length > 0 && (
        <section className="mb-7 rounded-[22px] border border-border bg-card p-5 sm:p-6" aria-label="句中标记">
          <h2 className="text-lg font-semibold">句中标记 <span className="ml-1 text-sm font-normal text-muted-foreground">{sentenceMarks.length} 处</span></h2>
          <div className="mt-2 divide-y divide-border">
            {sentenceMarks.map((mark) => (
              <article key={sentenceMarkKey(mark)} className="py-4">
                <div className="flex items-center justify-between gap-3">
                  <button className="inline-flex items-center gap-2 rounded font-heading text-xl font-semibold text-primary" onClick={() => onSpeak(mark.token)} aria-label={`播放 ${mark.token}`}>
                    {mark.token}<Volume2 className="size-4" />
                  </button>
                  <Button size="sm" variant="ghost" onClick={() => onRemoveMark(mark)} aria-label={`移除 ${mark.token} 的句中标记`}>移除标记</Button>
                </div>
                <p className="mt-2 text-base leading-7">{mark.example.english}</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{mark.example.chinese}</p>
                {!mark.wordId && <p className="mt-2 text-xs text-muted-foreground">词库暂未收录，可在这里听词、回看原句。</p>}
              </article>
            ))}
          </div>
        </section>
      )}
      {words.length === 0 && sentenceMarks.length === 0 ? (
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
                  <span>{record?.wrong ? `错误 ${record.wrong} 次` : '句中标记待复习'}</span>
                  <span className="max-w-[65%] truncate">{word.examples[0]?.english}</span>
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
            “已掌握”只统计经过多轮主动回忆、间隔达到 21 天以上的单词。
          </p>
        </article>
      </div>
    </>
  );
}

function ReviewSession({
  word,
  example,
  phase,
  retry,
  sessionMode,
  index,
  total,
  revealed,
  stats,
  done,
  onReveal,
  onGrade,
  onAdvance,
  onSpeak,
  onListen,
  onExit,
  sentenceDictionary,
  sentenceMarks,
  onSentenceMarks,
}: {
  word: Word;
  example: SentenceExample;
  phase: LearningPhase;
  retry: boolean;
  sessionMode: SessionMode;
  index: number;
  total: number;
  revealed: boolean;
  stats: { reviewed: number; correct: number };
  done: boolean;
  onReveal(): void;
  onGrade(grade: 0 | 1 | 2): void;
  onAdvance(): void;
  onSpeak(): void;
  onListen(): void;
  onExit(): void;
  sentenceDictionary: Map<string, Word>;
  sentenceMarks: SentenceMark[];
  onSentenceMarks: (example: SentenceExample, marks: SentenceMark[]) => void;
}) {
  const progress = done ? 100 : Math.round((index / total) * 100);
  const isListening = phase === 'listen' || phase === 'review-listen';
  const isAssessment = ['recall', 'review-listen', 'review-context'].includes(phase);
  const phaseLabel =
    phase === 'listen'
      ? '先听一句，抓住你能听到的词'
      : phase === 'study'
        ? '看懂这个词在句子里怎么用'
        : phase === 'review-listen'
          ? '听完整句，再回忆关键词'
          : retry
            ? '刚才没记牢，再从句子里想一次'
            : '结合整句，回忆加粗词的含义';
  useEffect(() => {
    if (!isListening || done) return;
    const timeout = window.setTimeout(() => speakSentence(example.english), 260);
    return () => window.clearTimeout(timeout);
  }, [done, isListening, word.id, example.english]);
  useEffect(() => () => speechPlayer.stop(), [word.id, phase, example.english, done]);

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
            {sessionMode === 'new' ? '新词背诵' : sessionMode === 'review' ? '到期复习' : '薄弱词巩固'}
          </p>
          <h1 className="mt-2 font-heading text-3xl font-semibold">这一组完成了</h1>
          <div className="mx-auto mt-8 grid max-w-sm grid-cols-2 divide-x divide-border rounded-2xl border border-border py-5">
            <div>
              <p className="text-2xl font-semibold">{stats.reviewed}</p>
              <p className="mt-1 text-xs text-muted-foreground">主动回忆</p>
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
      <PlaybackNotice />
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
          <span>{phaseLabel}</span>
          <Badge variant="outline" className="font-normal">
            {word.level === 'cet4' ? '四级' : '六级'}
          </Badge>
        </div>

        <article className="rounded-[26px] border border-border bg-card p-7 sm:p-12">
          {isListening && !revealed ? (
            <div className="py-6 text-center sm:py-10">
              <button
                onClick={onListen}
                className="mx-auto grid size-24 place-items-center rounded-full bg-secondary text-primary transition-transform hover:scale-[1.03]"
                aria-label="播放完整例句"
              >
                <Play className="ml-1 size-8" fill="currentColor" />
              </button>
              <h1 className="mt-8 font-heading text-2xl font-semibold sm:text-3xl">先别看文字，听一遍</h1>
              <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
                不需要逐字听清，先抓句子的语气和关键词。
              </p>
              <Button variant="outline" className="mt-9 rounded-full px-6" onClick={onReveal}>
                听完了，看原句
              </Button>
            </div>
          ) : (
            <>
              {phase === 'study' ? (
                <div className="text-center">
                  <button onClick={onSpeak} className="group inline-flex items-center gap-3" aria-label={'播放 ' + word.word}>
                    <h1 className="font-heading text-[clamp(2.8rem,9vw,5rem)] font-semibold leading-none tracking-[-0.055em]">{word.word}</h1>
                    <Volume2 className="size-5 text-muted-foreground transition-colors group-hover:text-foreground" />
                  </button>
                  <p className="mt-4 text-sm text-muted-foreground">{word.phonetic}</p>
                  <p className="mt-7 text-xl font-medium"><span className="mr-2 text-sm text-muted-foreground">{word.partOfSpeech}</span>{word.meaning}</p>
                </div>
              ) : (
                <div>
                  <div className="mb-5 flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">IN CONTEXT</span>
                    <Button size="sm" variant="ghost" onClick={onListen}><Volume2 data-icon="inline-start" />听原句</Button>
                  </div>
                  <SentencePicker example={example} word={word} dictionary={sentenceDictionary} marks={sentenceMarks} onSave={onSentenceMarks} onSpeak={(token) => void playWordPronunciation(token)} />
                </div>
              )}

              {phase === 'study' && (
                <div className="mt-10 rounded-2xl bg-muted/65 p-5">
                  <SentencePicker compact example={example} word={word} dictionary={sentenceDictionary} marks={sentenceMarks} onSave={onSentenceMarks} onSpeak={(token) => void playWordPronunciation(token)} />
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{example.chinese}</p>
                  <p className="mt-4 border-t border-border pt-4 text-sm text-muted-foreground">
                    先把整句看懂，再把 <strong className="font-semibold text-foreground">{word.word}</strong> 和“{word.meaning}”连起来。
                  </p>
                </div>
              )}

              {phase !== 'study' && !revealed ? (
                <div className="mt-12 text-center">
                  <p className="text-sm text-muted-foreground">先结合整句话想一想，不必逐字翻译。</p>
                  <Button className="mt-5 rounded-full px-6" onClick={onReveal}>我想好了，查看句中含义</Button>
                </div>
              ) : (
                phase !== 'study' && (
                  <div className="mt-10 border-t border-border pt-7">
                    <p className="text-lg"><span className="mr-2 text-sm text-muted-foreground">{word.partOfSpeech}</span>{word.meaning}</p>
                    <p className="mt-4 text-sm leading-7 text-muted-foreground">{example.chinese}</p>
                  </div>
                )
              )}

              {(phase === 'study' || (phase === 'listen' && revealed)) && (
                <Button className="mt-9 w-full sm:ml-auto sm:block sm:w-auto" onClick={onAdvance}>
                  继续下一词 <ArrowRight data-icon="inline-end" />
                </Button>
              )}

              {isAssessment && revealed && (
                <div className="mt-9 grid gap-2 sm:grid-cols-3">
                  <Button variant="outline" className="h-11 justify-between px-4" onClick={() => onGrade(0)}>
                    没想起来 <kbd className="text-xs text-muted-foreground">1</kbd>
                  </Button>
                  <Button variant="outline" className="h-11 justify-between px-4" onClick={() => onGrade(1)}>
                    有点模糊 <kbd className="text-xs text-muted-foreground">2</kbd>
                  </Button>
                  <Button className="h-11 justify-between px-4" onClick={() => onGrade(2)}>
                    想起来了 <kbd className="text-xs text-primary-foreground/70">3</kbd>
                  </Button>
                </div>
              )}
            </>
          )}
        </article>
      </section>
    </main>
  );
}

function Onboarding({
  nickname,
  onNicknameChange,
  level,
  examDate,
  score,
  fullScore,
  onLevelChange,
  onExamDateChange,
  onScoreChange,
  onFullScoreChange,
  onComplete,
}: {
  nickname: string;
  onNicknameChange: (name: string) => void;
  level: WordLevel;
  examDate: string;
  score: number;
  fullScore: number;
  onLevelChange(level: WordLevel): void;
  onExamDateChange(date: string): void;
  onScoreChange(score: number): void;
  onFullScoreChange(score: number): void;
  onComplete(): void;
}) {
  const preview = studyPlan({
    level,
    examDate,
    gaokaoScore: score,
    gaokaoFullScore: fullScore,
  });

  return (
    <main className="min-h-screen bg-background px-5 py-8 text-foreground">
      <header className="mx-auto flex max-w-4xl items-center justify-between">
        <span className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">词</span>
          <span className="font-semibold tracking-[0.12em]">词序</span>
        </span>
        <span className="text-xs text-muted-foreground">数据仅保存在当前设备</span>
      </header>
      <section className="mx-auto mt-[clamp(2.5rem,8vh,5.5rem)] max-w-4xl">
        <div className="grid gap-10 lg:grid-cols-[1fr_0.95fr] lg:items-start">
          <div>
            <Badge variant="outline" className="font-normal">按考试场次安排背词量</Badge>
            <h1 className="mt-5 font-heading text-[clamp(2.8rem,7vw,4.7rem)] font-semibold leading-[1.06] tracking-[-0.055em]">
              少做测试，
              <br />
              直接开始背。
            </h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-muted-foreground">
              选考试场次、填高考英语成绩，用来估算起点和每天的新词量。进入学习后，每组五个词，先听句子，再结合语境记。
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              四级范围 {WORD_COUNTS.cet4.toLocaleString()} 词；六级备考同时回收四级基础，共 {WORD_COUNTS.cet6Total.toLocaleString()} 个不重复词条。
            </p>
            <div className="mt-8 max-w-sm rounded-2xl border border-border bg-card p-5">
              <p className="text-sm text-muted-foreground">当前建议</p>
              <div className="mt-3 flex items-end justify-between gap-4">
                <div>
                  <p className="font-heading text-3xl font-semibold">每天 {preview.dailyNew} 个</p>
                  <p className="mt-2 text-sm text-muted-foreground">{preview.phase} · 距目标{examSchedule(examDate).confirmed ? '考试' : '场次约'} {preview.daysLeft} 天</p>
                </div>
                <Headphones className="mb-1 size-6 text-primary" />
              </div>
            </div>
          </div>
          <div className="rounded-[22px] border border-border bg-card p-6 sm:p-7">
            <div className="mb-6">
              <label htmlFor="setup-nickname" className="mb-2 block text-sm font-medium">怎么称呼你？<span className="ml-2 font-normal text-muted-foreground">选填</span></label>
              <Input id="setup-nickname" autoComplete="nickname" maxLength={24} value={nickname} onChange={(event) => onNicknameChange(event.target.value)} placeholder="一个你喜欢的称呼" className="h-10" />
            </div>
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
              <label className="mb-3 block text-sm font-medium" htmlFor="exam-session">目标考试场次</label>
              <ExamSessionSelect id="exam-session" value={examDate} onChange={onExamDateChange} />
              <ExamScheduleNote session={examDate} />
            </div>
            <div className="mt-7">
              <p className="text-sm font-medium">高考英语成绩</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">只用来粗定基础，不会把任何词直接判为掌握。</p>
              <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                <Input
                  type="number"
                  min={0}
                  max={fullScore}
                  value={score}
                  onChange={(event) => onScoreChange(Number(event.target.value))}
                  aria-label="高考英语得分"
                  className="h-11 text-center"
                />
                <span className="text-muted-foreground">/</span>
                <Input
                  type="number"
                  min={1}
                  value={fullScore}
                  onChange={(event) => onFullScoreChange(Number(event.target.value))}
                  aria-label="高考英语满分"
                  className="h-11 text-center"
                />
              </div>
            </div>
            <Button className="mt-8 h-11 w-full rounded-xl" onClick={onComplete} disabled={!examDate}>
              进入今日背诵
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl">学习设置</DialogTitle>
          <DialogDescription>设置会自动保存在当前浏览器。</DialogDescription>
        </DialogHeader>
        <div className="space-y-6 py-2">
          <div>
            <label htmlFor="settings-nickname" className="mb-2 block text-sm font-medium">称呼</label>
            <Input id="settings-nickname" autoComplete="nickname" maxLength={24} value={study.nickname} onChange={(event) => onStudyChange((current) => ({ ...current, nickname: event.target.value }))} onBlur={() => onStudyChange((current) => ({ ...current, nickname: normalizeNickname(current.nickname) }))} placeholder="一个你喜欢的称呼" />
          </div>
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
            <label className="mb-2 block text-sm font-medium" htmlFor="settings-exam-session">目标考试场次</label>
            <ExamSessionSelect id="settings-exam-session" value={study.examDate} onChange={(examDate) => onStudyChange((current) => ({ ...current, examDate }))} />
            <ExamScheduleNote session={study.examDate} />
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">高考英语成绩</p>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
              <Input
                type="number"
                min={0}
                max={study.gaokaoFullScore}
                value={study.gaokaoScore}
                onChange={(event) => onStudyChange((current) => ({ ...current, gaokaoScore: Number(event.target.value) }))}
                aria-label="高考英语得分"
                className="h-10 text-center"
              />
              <span className="text-muted-foreground">/</span>
              <Input
                type="number"
                min={1}
                value={study.gaokaoFullScore}
                onChange={(event) => onStudyChange((current) => ({ ...current, gaokaoFullScore: Math.max(1, Number(event.target.value)) }))}
                aria-label="高考英语满分"
                className="h-10 text-center"
              />
            </div>
            <div className="mt-3 rounded-xl bg-secondary/45 px-4 py-3 text-sm leading-6 text-muted-foreground">
              当前为 {studyPlan(study).phase}，建议每天新学 <strong className="font-semibold text-foreground">{studyPlan(study).dailyNew} 个</strong>。
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
          <div className="border-t border-border pt-5 text-xs leading-5 text-muted-foreground">
            <p>词表与双语例句来自 OpenEtymology，学习顺序参考开放词频数据；单词按钮优先播放开放词典音频，不可用时改用设备朗读。</p>
            <div className="mt-2 flex flex-wrap gap-x-3">
              <a className="underline underline-offset-2 hover:text-foreground" href="https://github.com/openetymology/OpenEtymology" target="_blank" rel="noreferrer">内容来源</a>
              <a className="underline underline-offset-2 hover:text-foreground" href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>
              <a className="underline underline-offset-2 hover:text-foreground" href="https://dictionaryapi.dev/" target="_blank" rel="noreferrer">发音来源</a>
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
