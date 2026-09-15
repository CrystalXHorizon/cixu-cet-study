import { cloudAudioUrl, prepareAudioCatalog } from './cloud-audio.ts';
import { normalizeAudioText } from './audio-text.ts';
export { sentenceChunks } from './audio-text.ts';

export type AudioPreferences = { voiceURI: string; rate: number };
export const DEFAULT_AUDIO: AudioPreferences = {
  voiceURI: 'af_heart',
  rate: 0.95,
};
export type PlaybackState = {
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'error';
  message: string;
  retryable?: boolean;
  notice?: string;
  text?: string;
  completedText?: string;
};
export function restoreAudioPreferences(value: unknown): AudioPreferences {
  const data =
    value && typeof value === 'object'
      ? (value as Partial<AudioPreferences>)
      : {};
  return {
    voiceURI: DEFAULT_AUDIO.voiceURI,
    rate:
      typeof data.rate === 'number' && Number.isFinite(data.rate)
        ? Math.max(0.65, Math.min(1.2, data.rate))
        : DEFAULT_AUDIO.rate,
  };
}
type Dependencies = {
  resolveUrl?: (text: string) => string | undefined;
  prepare?: () => Promise<void>;
  createAudio?: (url: string) => HTMLAudioElement;
};

// One native MP3 player serves words, sentences and follow-along chunks.
// Synthesis happens in GitHub Actions, never on the learner's device.
export class SpeechPlayer {
  preferences: AudioPreferences = DEFAULT_AUDIO;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private audio: HTMLAudioElement | undefined;
  private pending: (() => Promise<void>) | undefined;
  private resumeAction: (() => Promise<void>) | undefined;
  private retryAction: (() => void) | undefined;
  private listeners = new Set<() => void>();
  private state: PlaybackState = { status: 'idle', message: '' };
  private preloads: HTMLAudioElement[] = [];
  private preloadGeneration = 0;
  private readonly resolveUrl: (text: string) => string | undefined;
  private readonly prepareCatalog: () => Promise<void>;
  private readonly createAudio: (url: string) => HTMLAudioElement;
  constructor(dependencies: Dependencies = {}) {
    this.resolveUrl = dependencies.resolveUrl ?? cloudAudioUrl;
    this.prepareCatalog = dependencies.prepare ?? prepareAudioCatalog;
    this.createAudio = dependencies.createAudio ?? ((url) => new Audio(url));
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  private update(
    status: PlaybackState['status'],
    message = '',
    retryable = false,
    text = this.state.text,
    completedText?: string,
  ) {
    this.state = { status, message, retryable, text, completedText };
    this.listeners.forEach((listener) => listener());
  }
  stop = () => {
    this.generation++;
    clearTimeout(this.timer);
    this.pending = undefined;
    this.resumeAction = undefined;
    this.retryAction = undefined;
    if (this.audio) {
      this.audio.onplaying = null;
      this.audio.onwaiting = null;
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.pause();
    }
    this.update('idle', '', false, '');
  };
  retry = () => {
    this.retryAction?.();
  };
  prepare = async (texts: string[]) => {
    const ticket = ++this.preloadGeneration;
    try {
      await this.prepareCatalog();
      if (ticket !== this.preloadGeneration) return;
      this.preloads.forEach((audio) => {
        audio.removeAttribute('src');
        audio.load();
      });
      this.preloads = [...new Set(texts.map(normalizeAudioText))]
        .slice(0, 3)
        .flatMap((text) => {
          const url = this.resolveUrl(text);
          if (!url) return [];
          const audio = this.createAudio(url);
          audio.preload = 'auto';
          audio.load();
          return [audio];
        });
    } catch {
      /* Playback exposes prefetch failures with an explicit retry. */
    }
  };

  play(
    text: string,
    preferences: AudioPreferences = this.preferences,
    repetitions = 1,
  ): Promise<void> {
    this.stop();
    const normalized = normalizeAudioText(text);
    const ticket = this.generation;
    const options = restoreAudioPreferences(preferences);
    let remaining = Number.isFinite(repetitions)
      ? Math.max(1, Math.min(3, Math.floor(repetitions)))
      : 1;
    this.update('loading', '正在加载音频…', false, text);
    const fail = (message: string) => {
      if (ticket !== this.generation) return;
      this.generation++;
      clearTimeout(this.timer);
      this.audio?.pause();
      this.pending = undefined;
      this.retryAction = () => {
        void this.play(text, options, repetitions);
      };
      this.update('error', message, true, text);
    };
    const begin = (): Promise<void> => {
      if (ticket !== this.generation) return Promise.resolve();
      if (this.state.status === 'paused') {
        this.pending = () => {
          this.pending = undefined;
          this.update('loading', '正在加载音频…');
          return begin();
        };
        return Promise.resolve();
      }
      const url = this.resolveUrl(normalized);
      if (!url) {
        fail('这段内容暂时没有对应音频，请尝试词库中的其他例句。');
        return Promise.resolve();
      }
      try {
        const audio = this.audio ?? (this.audio = this.createAudio(url));
        audio.src = url;
        audio.preload = 'auto';
        audio.playbackRate = options.rate;
        audio.preservesPitch = true;
        audio.volume = 1;
        audio.muted = false;
        const watchLoading = () => {
          clearTimeout(this.timer);
          this.timer = setTimeout(
            () => fail('音频加载时间较长，请检查网络后点击重试。'),
            12000,
          );
        };
        const start = (restart = false): Promise<void> => {
          if (ticket !== this.generation) return Promise.resolve();
          if (restart) audio.currentTime = 0;
          this.update('loading', '正在加载音频…');
          watchLoading();
          // Call play() in the click handler whenever the catalog is warm.
          return audio
            .play()
            .then(() => {
              if (ticket !== this.generation || this.state.status === 'paused')
                return;
              clearTimeout(this.timer);
              this.update('playing', '正在播放');
            })
            .catch((error: unknown) => {
              if (ticket !== this.generation) return;
              if (
                error instanceof Error &&
                error.name === 'AbortError' &&
                this.state.status === 'paused'
              )
                return;
              fail(
                error instanceof Error && error.name === 'NotAllowedError'
                  ? '音频已准备好，请点击播放。'
                  : '音频暂时无法播放，请检查网络后点击重试。',
              );
            });
        };
        this.resumeAction = () => start();
        audio.onplaying = () => {
          if (ticket !== this.generation || this.state.status === 'paused')
            return;
          clearTimeout(this.timer);
          this.update('playing', '正在播放');
        };
        audio.onwaiting = () => {
          if (ticket !== this.generation || this.state.status === 'paused')
            return;
          this.update('loading', '正在缓冲音频…');
          watchLoading();
        };
        audio.onerror = () => fail('音频暂时无法播放，请检查网络后点击重试。');
        audio.onended = () => {
          if (ticket !== this.generation) return;
          clearTimeout(this.timer);
          if (--remaining <= 0) {
            this.pending = undefined;
            this.resumeAction = undefined;
            this.update('idle', '', false, text, text);
            return;
          }
          this.pending = () => {
            this.pending = undefined;
            return start(true);
          };
          if (this.state.status === 'paused') return;
          this.update('playing', '稍候再听一遍…');
          this.timer = setTimeout(() => {
            void this.pending?.();
          }, 800);
        };
        return start();
      } catch {
        fail('暂时无法启动音频，请点击重试。');
        return Promise.resolve();
      }
    };
    if (this.resolveUrl(normalized)) return begin();
    return this.prepareCatalog()
      .then(begin)
      .catch(() => fail('音频列表暂时没加载出来，请检查网络后点击重试。'));
  }
  playWord(word: string, preferences: AudioPreferences = this.preferences) {
    return this.play(word.toLowerCase().replaceAll('’', "'"), preferences);
  }
  pause = () => {
    if (this.state.status !== 'playing' && this.state.status !== 'loading')
      return;
    clearTimeout(this.timer);
    this.audio?.pause();
    this.update('paused', '已暂停');
  };
  resume = () => {
    if (this.state.status !== 'paused') return;
    if (this.pending) void this.pending();
    else if (this.resumeAction) void this.resumeAction();
    else this.update('loading', '正在加载音频…');
  };
}
export const speechPlayer = new SpeechPlayer();
