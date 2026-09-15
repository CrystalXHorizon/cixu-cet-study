import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Headphones,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

type Sample = {
  id: string;
  word: string;
  group: string;
  english: string;
  chinese: string;
  file: string;
  duration: number;
};
type Manifest = { samples: Sample[] };
type Status = 'idle' | 'loading' | 'playing' | 'paused' | 'error';
const base = import.meta.env.BASE_URL;
const audioRoot = `${base}audio/cloud-preview/`;

export default function CloudAudioPreview() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [rate, setRate] = useState(1);
  const [continuous, setContinuous] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const ticketRef = useRef(0);
  const selectedRef = useRef(0);
  const autoRef = useRef(false);
  const sample = manifest?.samples[index];

  useEffect(() => {
    document.title = '15 句新语音试听｜词序';
    const controller = new AbortController();
    fetch(`${audioRoot}manifest.json`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Audio list unavailable');
        const data = (await response.json()) as Manifest;
        if (
          data.samples?.length !== 15 ||
          data.samples.some((item) => !/^sentence-\d{2}\.mp3$/.test(item.file))
        )
          throw new Error('Invalid audio list');
        setManifest(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadError(true);
      });
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    const player = audioRef.current;
    return () => {
      player?.pause();
    };
  }, [manifest]);

  // Warm only the next two small recordings, keeping the rest on demand.
  useEffect(() => {
    if (!manifest) return;
    const upcoming = manifest.samples
      .slice(index + 1, index + 3)
      .map((item) => {
        const preload = new Audio();
        preload.preload = 'auto';
        preload.src = `${audioRoot}${item.file}`;
        preload.load();
        return preload;
      });
    return () =>
      upcoming.forEach((preload) => {
        preload.removeAttribute('src');
        preload.load();
      });
  }, [manifest, index]);

  function play(nextIndex = selectedRef.current, restart = false) {
    const audio = audioRef.current;
    const next = manifest?.samples[nextIndex];
    if (!audio || !next) return;
    const ticket = ++ticketRef.current;
    selectedRef.current = nextIndex;
    setIndex(nextIndex);
    setMessage('');
    setStatus('loading');
    const source = new URL(`${audioRoot}${next.file}`, window.location.href)
      .href;
    if (audio.src !== source || audio.error) {
      audio.src = source;
      audio.load();
    } else if (restart || audio.ended) {
      audio.currentTime = 0;
    }
    audio.playbackRate = rate;
    audio.preservesPitch = true;
    // Start within the click; don't await downloads before calling play().
    void audio
      .play()
      .then(() => {
        if (ticket === ticketRef.current && !audio.paused) setStatus('playing');
      })
      .catch((error: unknown) => {
        if (ticket !== ticketRef.current) return;
        if (
          error instanceof Error &&
          error.name === 'AbortError' &&
          audio.paused
        )
          return;
        setStatus('error');
        setMessage(
          error instanceof Error && error.name === 'NotAllowedError'
            ? '请再点一次播放，也可以使用下方播放器。'
            : '音频暂时没加载出来，请检查网络后重试。',
        );
      });
  }

  function togglePlayback() {
    const audio = audioRef.current;
    if (audio && !audio.paused) {
      ticketRef.current++;
      audio.pause();
      setStatus('paused');
    } else play();
  }

  function changeRate(value: string | null) {
    const next = Number(value);
    if (![0.8, 1, 1.2].includes(next)) return;
    setRate(next);
    if (audioRef.current) {
      audioRef.current.playbackRate = next;
      audioRef.current.preservesPitch = true;
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/80">
        <div className="mx-auto flex min-h-16 max-w-5xl items-center justify-between gap-4 px-5 py-3 sm:px-8">
          <a
            href={base}
            className="flex items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span className="grid size-8 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
              词
            </span>
            <span className="text-[17px] font-semibold tracking-[0.12em]">
              词序
            </span>
          </a>
          <a
            href={base}
            className="flex min-h-10 items-center gap-2 text-sm text-muted-foreground hover:text-primary"
          >
            <ArrowLeft className="size-4" />
            返回学习
          </a>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
        <div className="mb-7 flex items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-sm font-medium tracking-wider text-primary">
              英语整句试听
            </p>
            <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
              听听这 15 句。
            </h1>
            <p className="mt-3 text-base leading-7 text-muted-foreground">
              同一种美式女声，从日常短句到进阶表达。
            </p>
          </div>
          <Headphones
            className="mt-2 hidden size-9 text-primary/70 sm:block"
            strokeWidth={1.4}
          />
        </div>
        {!manifest ? (
          <div
            className="rounded-3xl border border-border bg-card p-8"
            aria-live="polite"
          >
            {loadError ? (
              <>
                <p>试听列表暂时没加载出来。</p>
                <Button
                  className="mt-4 h-11 px-5"
                  onClick={() => {
                    setLoadError(false);
                    setAttempt((value) => value + 1);
                  }}
                >
                  重新加载
                </Button>
              </>
            ) : (
              <p className="flex items-center gap-3">
                <LoaderCircle className="size-5 animate-spin" />
                正在加载 15 条试听…
              </p>
            )}
          </div>
        ) : (
          sample && (
            <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
              <section
                aria-label="当前试听"
                className="rounded-[26px] border border-primary/20 bg-card p-6 shadow-sm sm:p-8 lg:sticky lg:top-6"
              >
                <div className="mb-7 flex flex-wrap items-center justify-between gap-3 text-sm">
                  <span className="rounded-full bg-secondary px-3 py-1.5 font-medium text-primary">
                    {sample.group}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {String(index + 1).padStart(2, '0')} / 15
                  </span>
                </div>
                <p
                  lang="en"
                  className="min-h-32 font-heading text-[1.75rem] leading-[1.5] tracking-tight sm:text-[2rem]"
                >
                  {sample.english}
                </p>
                <p className="mt-5 min-h-14 text-base leading-7 text-muted-foreground">
                  {sample.chinese}
                </p>
                <div className="mt-7 flex items-center justify-center gap-4">
                  <Button
                    variant="ghost"
                    className="size-11 rounded-full"
                    aria-label="上一句并播放"
                    disabled={index === 0}
                    onClick={() => play(index - 1, true)}
                  >
                    <SkipBack />
                  </Button>
                  <Button
                    className="size-16 rounded-full shadow-sm"
                    aria-label={
                      status === 'playing' ? '暂停试听' : '播放当前句子'
                    }
                    onClick={togglePlayback}
                  >
                    {status === 'playing' ? (
                      <Pause className="size-6" fill="currentColor" />
                    ) : status === 'loading' ? (
                      <LoaderCircle className="size-6 animate-spin" />
                    ) : (
                      <Play className="ml-1 size-6" fill="currentColor" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    className="size-11 rounded-full"
                    aria-label="下一句并播放"
                    disabled={index === 14}
                    onClick={() => play(index + 1, true)}
                  >
                    <SkipForward />
                  </Button>
                </div>
                <p
                  aria-live="polite"
                  className={cn(
                    'mt-3 min-h-6 text-center text-sm',
                    status === 'error'
                      ? 'text-destructive'
                      : 'text-muted-foreground',
                  )}
                >
                  {message ||
                    (status === 'loading'
                      ? '正在加载音频…'
                      : status === 'playing'
                        ? '正在播放'
                        : status === 'paused'
                          ? '已暂停'
                          : '点击播放，听完整句子')}
                </p>
                <audio
                  ref={audioRef}
                  src={`${audioRoot}${manifest.samples[0].file}`}
                  controls
                  preload="metadata"
                  aria-label="英语例句播放器"
                  className="mt-3 h-11 w-full"
                  onPlaying={() => {
                    setStatus('playing');
                    setMessage('');
                  }}
                  onWaiting={() => setStatus('loading')}
                  onPause={() => {
                    if (!audioRef.current?.ended) setStatus('paused');
                  }}
                  onEnded={() => {
                    const next = selectedRef.current + 1;
                    if (autoRef.current && next < manifest.samples.length)
                      play(next, true);
                    else {
                      setStatus('idle');
                      setMessage(
                        autoRef.current
                          ? '已播到最后一句，可以选一句再听。'
                          : '这一句听完了，试试下一句。',
                      );
                    }
                  }}
                  onError={() => {
                    if (audioRef.current?.error) {
                      setStatus('error');
                      setMessage('音频暂时无法播放，请点击播放重试。');
                    }
                  }}
                >
                  <track
                    kind="captions"
                    src={`${audioRoot}${sample.id}.vtt`}
                    srcLang="en"
                    label="English"
                    default
                  />
                </audio>
                <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5">
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor="preview-rate"
                      className="text-sm text-muted-foreground"
                    >
                      语速
                    </label>
                    <Select value={String(rate)} onValueChange={changeRate}>
                      <SelectTrigger id="preview-rate" className="h-10 w-24">
                        <SelectValue>
                          {rate === 1 ? '自然' : `${rate}×`}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false}>
                        <SelectItem value="0.8">0.8×</SelectItem>
                        <SelectItem value="1">自然</SelectItem>
                        <SelectItem value="1.2">1.2×</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    variant="ghost"
                    className="h-10 px-3"
                    onClick={() => play(index, true)}
                  >
                    <RotateCcw />
                    重播
                  </Button>
                  <label
                    className="flex min-h-10 cursor-pointer items-center gap-3 text-sm"
                    htmlFor="preview-continuous"
                  >
                    连续试听
                    <Switch
                      id="preview-continuous"
                      checked={continuous}
                      onCheckedChange={(checked) => {
                        autoRef.current = checked;
                        setContinuous(checked);
                      }}
                    />
                  </label>
                </div>
              </section>
              <section aria-label="15 条试听例句" className="min-w-0">
                {['日常短句', '自然连读', '进阶表达'].map((group) => (
                  <div key={group} className="mb-6 last:mb-0">
                    <h2 className="mb-2 px-3 text-sm font-semibold text-muted-foreground">
                      {group}
                    </h2>
                    <ol className="space-y-1">
                      {manifest.samples.map((item, position) =>
                        item.group !== group ? null : (
                          <li key={item.id}>
                            <button
                              type="button"
                              onClick={() => play(position, true)}
                              aria-label={`试听第 ${position + 1} 句：${item.english}`}
                              aria-current={
                                position === index ? 'true' : undefined
                              }
                              className={cn(
                                'flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-primary sm:p-4',
                                position === index
                                  ? 'border-primary/20 bg-secondary'
                                  : 'border-transparent hover:border-border hover:bg-card',
                              )}
                            >
                              <span className="w-6 shrink-0 text-sm tabular-nums text-muted-foreground">
                                {String(position + 1).padStart(2, '0')}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span
                                  lang="en"
                                  className="block text-base leading-6"
                                >
                                  {item.english}
                                </span>
                                <span className="mt-1 block text-sm text-muted-foreground">
                                  {item.word} · {Math.round(item.duration)} 秒
                                </span>
                              </span>
                              {position === index && status === 'playing' ? (
                                <Pause className="size-4 shrink-0 text-primary" />
                              ) : (
                                <Play className="size-4 shrink-0 text-primary" />
                              )}
                            </button>
                          </li>
                        ),
                      )}
                    </ol>
                  </div>
                ))}
              </section>
            </div>
          )
        )}
        <footer className="mt-10 border-t border-border pt-5 text-sm leading-6 text-muted-foreground">
          例句来自词序词库 · 美式女声 · 合成语音
        </footer>
      </div>
    </main>
  );
}
