import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  ArrowRight,
  Check,
  Headphones,
  Pause,
  Play,
  RotateCcw,
  Square,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SentencePicker } from '@/components/sentence-picker';
import {
  DEFAULT_AUDIO,
  englishVoices,
  sentenceChunks,
  speechPlayer,
  type AudioPreferences,
} from '@/lib/speech-player';
import { type ListeningItem } from '@/lib/listening-queue';
import { type SentenceMark } from '@/lib/sentence-words';
import type { SentenceExample, Word } from '@/lib/words';
import { cn } from '@/lib/utils';

export function ListeningPractice({
  items,
  preferences,
  onPreferences,
  dictionary,
  marks,
  onMarks,
  onComplete,
  onExit,
}: {
  items: ListeningItem[];
  preferences: AudioPreferences;
  onPreferences: (preferences: AudioPreferences) => void;
  dictionary: Map<string, Word>;
  marks: SentenceMark[];
  onMarks: (example: SentenceExample, marks: SentenceMark[]) => void;
  onComplete: (understood: boolean) => void;
  onExit: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [stage, setStage] = useState(0);
  const [repetitions, setRepetitions] = useState(1);
  const [understoodCount, setUnderstoodCount] = useState(0);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() =>
    typeof window === 'undefined'
      ? []
      : englishVoices(window.speechSynthesis?.getVoices() ?? []),
  );
  const playback = useSyncExternalStore(
    speechPlayer.subscribe,
    speechPlayer.getSnapshot,
    speechPlayer.getSnapshot,
  );
  const item = items[index];
  const done = index >= items.length;

  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const update = () => setVoices(englishVoices(synth.getVoices()));
    synth.addEventListener('voiceschanged', update);
    return () => {
      synth.removeEventListener('voiceschanged', update);
      speechPlayer.stop();
    };
  }, []);

  function updatePreferences(next: AudioPreferences) {
    speechPlayer.stop();
    onPreferences(next);
  }

  function finish(understood: boolean) {
    speechPlayer.stop();
    onComplete(understood);
    if (understood) setUnderstoodCount((count) => count + 1);
    setIndex((current) => current + 1);
    setStage(0);
  }

  if (done)
    return (
      <main className="grid min-h-screen place-items-center bg-background px-5 py-10">
        <section className="w-full max-w-lg rounded-[26px] border border-border bg-card p-8 text-center">
          <Headphones className="mx-auto size-9 text-primary" />
          <h1 className="mt-6 font-heading text-3xl font-semibold">
            今天又多听懂了几句。
          </h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            本组完成 {items.length} 句，已听懂 {understoodCount}{' '}
            句。标记的生词可以回错词本继续巩固。
          </p>
          <Progress aria-label="本组听力进度" value={100} className="mt-6" />
          <Button className="mt-8 h-11 rounded-full px-6" onClick={onExit}>
            回到今日
            <ArrowRight data-icon="inline-end" />
          </Button>
        </section>
      </main>
    );

  const unavailable = typeof window !== 'undefined' && !window.speechSynthesis;
  const busy = playback.status === 'playing';
  const chosenVoice = voices.find(
    (voice) => voice.voiceURI === preferences.voiceURI,
  );
  return (
    <main className="min-h-screen bg-background px-5 py-6 text-foreground">
      <header className="mx-auto flex max-w-4xl items-center gap-4">
        <Button
          size="icon"
          variant="ghost"
          aria-label="退出听力专项"
          onClick={() => {
            speechPlayer.stop();
            onExit();
          }}
        >
          <X />
        </Button>
        <Progress
          aria-label="本组听力进度"
          value={(index / items.length) * 100}
          className="flex-1"
        />
        <span className="text-sm tabular-nums text-muted-foreground">
          {index + 1} / {items.length}
        </span>
      </header>
      <section className="mx-auto mt-10 max-w-3xl sm:mt-14">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-sm text-muted-foreground">
              整句精听 · 每组最多五句
            </p>
            <h1 className="font-heading text-3xl font-semibold">听力专项</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            听懂大意，再听清细节。
          </p>
        </div>
        <div className="mb-5 grid grid-cols-3 gap-2 text-center text-sm">
          {['先听整句', '核对理解', '分句跟读'].map((label, step) => (
            <span
              key={label}
              className={cn(
                'rounded-full px-2 py-2',
                stage === step
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary/55 text-muted-foreground',
              )}
            >
              {step + 1} · {label}
            </span>
          ))}
        </div>
        <article className="rounded-[26px] border border-border bg-card p-6 sm:p-10">
          <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto]">
            <div className="min-w-0">
              <label
                htmlFor="listening-voice"
                className="mb-2 block text-sm text-muted-foreground"
              >
                英语音色
              </label>
              <Select
                value={chosenVoice?.voiceURI ?? 'auto'}
                onValueChange={(value) =>
                  updatePreferences({
                    ...preferences,
                    voiceURI: value === 'auto' ? '' : (value ?? ''),
                  })
                }
              >
                <SelectTrigger id="listening-voice" className="h-10 w-full">
                  <SelectValue>
                    {chosenVoice?.name ?? '自动选择英语音色'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectItem value="auto">自动选择英语音色</SelectItem>
                  {voices.map((voice) => (
                    <SelectItem key={voice.voiceURI} value={voice.voiceURI}>
                      {voice.name} · {voice.lang}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label
                htmlFor="listening-rate"
                className="mb-2 block text-sm text-muted-foreground"
              >
                语速
              </label>
              <Select
                value={String(preferences.rate)}
                onValueChange={(value) =>
                  updatePreferences({
                    ...preferences,
                    rate: Number(value) || DEFAULT_AUDIO.rate,
                  })
                }
              >
                <SelectTrigger id="listening-rate" className="h-10 w-full">
                  <SelectValue>
                    {preferences.rate === 0.95
                      ? '自然'
                      : `${preferences.rate}×`}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {[0.75, 0.85, 0.95, 1.1].map((rate) => (
                    <SelectItem key={rate} value={String(rate)}>
                      {rate === 0.95 ? '自然' : `${rate}×`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label
                htmlFor="listening-repeat"
                className="mb-2 block text-sm text-muted-foreground"
              >
                连播
              </label>
              <Select
                value={String(repetitions)}
                onValueChange={(value) => {
                  speechPlayer.stop();
                  setRepetitions(Number(value) || 1);
                }}
              >
                <SelectTrigger id="listening-repeat" className="h-10 w-full">
                  <SelectValue>{repetitions} 遍</SelectValue>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {[1, 2, 3].map((count) => (
                    <SelectItem key={count} value={String(count)}>
                      {count} 遍
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {stage === 0 ? (
            <div className="py-10 text-center">
              <button
                type="button"
                disabled={playback.status === 'loading'}
                className="mx-auto grid size-24 place-items-center rounded-full bg-secondary text-primary transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
                aria-label={
                  busy
                    ? '暂停播放'
                    : playback.status === 'paused'
                      ? '继续播放'
                      : '播放完整例句'
                }
                onClick={() =>
                  busy
                    ? speechPlayer.pause()
                    : playback.status === 'paused'
                      ? speechPlayer.resume()
                      : void speechPlayer.play(
                          item.example.english,
                          preferences,
                          repetitions,
                        )
                }
              >
                {busy ? (
                  <Pause className="size-8" />
                ) : (
                  <Play className="ml-1 size-8" />
                )}
              </button>
              <p className="mt-5 text-lg font-medium">这句话在讲什么？</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                先抓住谁、做了什么、结果怎样。可以多听几遍。
              </p>
            </div>
          ) : (
            <div className="mt-8">
              <SentencePicker
                example={item.example}
                word={item.word}
                dictionary={dictionary}
                marks={marks}
                onSave={onMarks}
                onSpeak={(token) =>
                  void speechPlayer.playWord(token, preferences)
                }
              />
              <p className="mt-6 border-t border-border pt-5 text-base leading-7 text-muted-foreground">
                {item.example.chinese}
              </p>
              {stage === 2 && (
                <div className="mt-6 rounded-2xl bg-muted/60 p-4">
                  <p className="mb-3 text-sm text-muted-foreground">
                    点一段听一句，停下来跟读。
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {sentenceChunks(item.example.english).map((chunk, part) => (
                      <button
                        key={part}
                        className="rounded-xl border border-border bg-card px-3 py-2 text-left text-base leading-7 hover:border-primary focus-visible:outline-2 focus-visible:outline-primary"
                        onClick={() =>
                          void speechPlayer.play(chunk, preferences)
                        }
                      >
                        <Play className="mr-2 inline size-3.5 text-primary" />
                        {chunk}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Button
              variant="ghost"
              onClick={() =>
                void speechPlayer.play(
                  item.example.english,
                  preferences,
                  repetitions,
                )
              }
            >
              <RotateCcw data-icon="inline-start" />
              重听整句
            </Button>
            {stage > 0 && (
              <Button
                variant="ghost"
                disabled={
                  playback.status !== 'playing' && playback.status !== 'paused'
                }
                onClick={() =>
                  playback.status === 'paused'
                    ? speechPlayer.resume()
                    : speechPlayer.pause()
                }
              >
                {playback.status === 'paused' ? <Play /> : <Pause />}
                {playback.status === 'paused' ? '继续播放' : '暂停'}
              </Button>
            )}
            <Button
              variant="ghost"
              disabled={playback.status === 'idle'}
              onClick={speechPlayer.stop}
            >
              <Square data-icon="inline-start" />
              停止
            </Button>
          </div>
          <output
            className={cn(
              'mt-3 block min-h-6 text-center text-sm',
              unavailable || playback.status === 'error'
                ? 'text-destructive'
                : 'text-muted-foreground',
            )}
          >
            {unavailable
              ? '此浏览器暂不支持朗读，可以查看原文或换浏览器收听。'
              : playback.message ||
                (playback.status === 'loading'
                  ? '正在准备英语语音…'
                  : playback.status === 'playing'
                    ? '正在播放'
                    : playback.status === 'paused'
                      ? '已暂停'
                      : voices[0]
                        ? `当前音色：${chosenVoice?.name ?? voices[0].name}`
                        : '使用浏览器英语语音')}
          </output>
          {stage < 2 ? (
            <Button
              className="mt-6 h-11 w-full rounded-full"
              onClick={() => {
                speechPlayer.stop();
                setStage((current) => current + 1);
              }}
            >
              {stage === 0 ? '看原文，核对理解' : '开始分句跟读'}
              <ArrowRight data-icon="inline-end" />
            </Button>
          ) : (
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <Button
                variant="outline"
                className="h-11 rounded-full"
                onClick={() => finish(false)}
              >
                还需巩固，继续下一句
              </Button>
              <Button
                className="h-11 rounded-full"
                onClick={() => finish(true)}
              >
                听懂了，继续
                <Check data-icon="inline-end" />
              </Button>
            </div>
          )}
        </article>
      </section>
    </main>
  );
}
