import { cachedPronunciation, preparePronunciation } from './pronunciation.ts';

export type AudioPreferences = { voiceURI: string; rate: number };
export const DEFAULT_AUDIO: AudioPreferences = { voiceURI: '', rate: 0.95 };
export type PlaybackState = {
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'error';
  message: string;
  retryable?: boolean;
};

export function restoreAudioPreferences(value: unknown): AudioPreferences {
  const data =
    value && typeof value === 'object'
      ? (value as Partial<AudioPreferences>)
      : {};
  return {
    voiceURI: typeof data.voiceURI === 'string' ? data.voiceURI : '',
    rate:
      typeof data.rate === 'number' && Number.isFinite(data.rate)
        ? Math.max(0.65, Math.min(1.2, data.rate))
        : DEFAULT_AUDIO.rate,
  };
}

export function englishVoices(voices: SpeechSynthesisVoice[]) {
  const score = (voice: SpeechSynthesisVoice) =>
    (/natural|neural|enhanced|premium/i.test(voice.name) ? 100 : 0) +
    (/Google/i.test(voice.name) ? 30 : 0) +
    (/^en[-_]US$/i.test(voice.lang) ? 10 : 0) +
    (voice.default ? 5 : 0);
  return voices
    .filter((voice) => /^en(?:[-_]|$)/i.test(voice.lang))
    .sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
}

export function sentenceChunks(sentence: string) {
  const clauses = sentence
    .match(/[^,;:!?.]+[,;:!?.]*/g)
    ?.map((part) => part.trim())
    .filter(Boolean) ?? [sentence];
  return clauses.flatMap((clause) => {
    const words = clause.split(/\s+/);
    if (words.length <= 10) return [clause];
    const count = Math.ceil(words.length / 8);
    const size = Math.ceil(words.length / count);
    return Array.from({ length: count }, (_, index) =>
      words.slice(index * size, (index + 1) * size).join(' '),
    );
  });
}

// One shared player prevents a word pronunciation from talking over a sentence.
export class SpeechPlayer {
  preferences: AudioPreferences = DEFAULT_AUDIO;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private audio: HTMLAudioElement | undefined;
  private pending: (() => void) | undefined;
  private utterance: SpeechSynthesisUtterance | undefined;
  private listeners = new Set<() => void>();
  private state: PlaybackState = { status: 'idle', message: '' };
  private voiceCache: SpeechSynthesisVoice[] = [];
  private cancelVoiceWait: (() => void) | undefined;
  private retryAction: (() => void) | undefined;
  constructor(
    private engine: () => SpeechSynthesis | undefined = () =>
      typeof window === 'undefined' ? undefined : window.speechSynthesis,
    private createUtterance: (text: string) => SpeechSynthesisUtterance = (
      text,
    ) => new SpeechSynthesisUtterance(text),
    private createAudio: (url: string) => HTMLAudioElement = (url) =>
      new Audio(url),
  ) {}
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
  ) {
    this.state = { status, message, retryable };
    this.listeners.forEach((listener) => listener());
  }
  stop = () => {
    this.generation++;
    clearTimeout(this.timer);
    this.cancelVoiceWait?.();
    this.cancelVoiceWait = undefined;
    this.pending = undefined;
    this.retryAction = undefined;
    this.audio?.pause();
    this.audio = undefined;
    this.engine()?.cancel();
    this.utterance = undefined;
    this.update('idle');
  };
  retry = () => {
    this.retryAction?.();
  };
  async play(
    text: string,
    preferences: AudioPreferences = this.preferences,
    repetitions = 1,
  ) {
    this.stop();
    const engine = this.engine();
    if (!engine) {
      this.update('error', '当前浏览器不支持朗读，请换用支持语音的浏览器。');
      return;
    }
    const ticket = this.generation;
    this.update('loading');
    let voices = englishVoices(engine.getVoices());
    if (!voices.length) {
      await new Promise<void>((resolve) => {
        const complete = () => {
          clearTimeout(timer);
          engine.removeEventListener('voiceschanged', complete);
          this.cancelVoiceWait = undefined;
          resolve();
        };
        const timer = setTimeout(complete, 1200);
        this.cancelVoiceWait = complete;
        engine.addEventListener('voiceschanged', complete);
      });
      voices = englishVoices(engine.getVoices());
    }
    if (ticket !== this.generation) return;
    this.voiceCache = voices;
    let remaining = Math.max(1, Math.min(3, repetitions));
    const next = () => {
      if (ticket !== this.generation) return;
      const utterance = this.createUtterance(text.replace(/\s+/g, ' ').trim());
      const voice =
        this.voiceCache.find(
          (item) => item.voiceURI === preferences.voiceURI,
        ) ?? this.voiceCache[0];
      utterance.lang = voice?.lang ?? 'en-US';
      if (voice) utterance.voice = voice;
      utterance.rate = restoreAudioPreferences(preferences).rate;
      utterance.pitch = 1;
      utterance.onstart = () => {
        if (ticket === this.generation) {
          clearTimeout(this.timer);
          this.update('playing');
        }
      };
      utterance.onend = () => {
        if (ticket !== this.generation) return;
        clearTimeout(this.timer);
        remaining--;
        if (remaining <= 0) {
          this.utterance = undefined;
          this.update('idle');
          return;
        }
        this.pending = () => {
          this.pending = undefined;
          next();
        };
        if (this.state.status !== 'paused')
          this.timer = setTimeout(() => this.pending?.(), 800);
      };
      utterance.onerror = (event) => {
        if (
          ticket !== this.generation ||
          event.error === 'canceled' ||
          event.error === 'interrupted'
        )
          return;
        clearTimeout(this.timer);
        this.retryAction = () => void this.play(text, preferences, repetitions);
        this.update(
          'error',
          '朗读未能启动。请点重试；仍无声时请检查站点静音或切换英语音色。',
          true,
        );
      };
      this.utterance = utterance;
      engine.resume();
      this.update('loading', '正在启动英语语音…');
      this.timer = setTimeout(() => {
        if (ticket !== this.generation) return;
        this.stop();
        this.retryAction = () => void this.play(text, preferences, repetitions);
        this.update(
          'error',
          '没有收到语音播放响应。请点重试，或换用已安装英语语音的浏览器。',
          true,
        );
      }, 5000);
      try {
        engine.speak(utterance);
      } catch {
        clearTimeout(this.timer);
        this.retryAction = () => void this.play(text, preferences, repetitions);
        this.update('error', '浏览器未允许朗读，请点重试。', true);
      }
    };
    next();
  }
  pause = () => {
    if (this.state.status !== 'playing') return;
    clearTimeout(this.timer);
    this.engine()?.pause();
    this.audio?.pause();
    this.update('paused');
  };
  resume = () => {
    if (this.state.status !== 'paused') return;
    this.engine()?.resume();
    void this.audio
      ?.play()
      .catch(() => this.update('error', '播放未能继续，请重播。'));
    if (this.pending) this.pending();
    this.update('playing');
  };
  async playWord(
    word: string,
    preferences: AudioPreferences = this.preferences,
    useFallback = false,
  ) {
    this.stop();
    const ticket = this.generation;
    this.update('loading', `正在准备 ${word} 的发音…`);
    try {
      // Cached recordings start within the click, retaining browser user activation.
      const recording =
        cachedPronunciation(word) ?? (await preparePronunciation(word));
      if (ticket !== this.generation) return;
      const audio = this.createAudio(
        useFallback ? (recording.fallbackUrl ?? recording.url) : recording.url,
      );
      this.audio = audio;
      audio.volume = 1;
      audio.muted = false;
      const fallback = () => {
        if (ticket === this.generation) {
          if (!useFallback && recording.fallbackUrl)
            void this.playWord(word, preferences, true);
          else void this.play(word, preferences);
        }
      };
      audio.onended = () => {
        if (ticket === this.generation) {
          clearTimeout(this.timer);
          this.update('idle');
        }
      };
      audio.onerror = fallback;
      this.timer = setTimeout(fallback, 8000);
      try {
        await audio.play();
      } catch (error) {
        if (ticket !== this.generation) return;
        clearTimeout(this.timer);
        if (error instanceof Error && error.name === 'NotAllowedError') {
          this.retryAction = () =>
            void this.playWord(word, preferences, useFallback);
          this.update(
            'error',
            `${word} 的音频已就绪，请再点一次播放以允许浏览器出声。`,
            true,
          );
          return;
        }
        fallback();
        return;
      }
      if (ticket !== this.generation) {
        audio.pause();
        return;
      }
      clearTimeout(this.timer);
      this.update('playing', `正在播放 ${word}`);
    } catch {
      if (ticket === this.generation) void this.play(word, preferences);
    }
  }
}

export const speechPlayer = new SpeechPlayer();
