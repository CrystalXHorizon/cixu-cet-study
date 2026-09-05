export type AudioPreferences = { voiceURI: string; rate: number };
export const DEFAULT_AUDIO: AudioPreferences = { voiceURI: '', rate: 0.95 };
export type PlaybackState = {
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'error';
  message: string;
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
  constructor(
    private engine: () => SpeechSynthesis | undefined = () =>
      typeof window === 'undefined' ? undefined : window.speechSynthesis,
    private createUtterance: (text: string) => SpeechSynthesisUtterance = (
      text,
    ) => new SpeechSynthesisUtterance(text),
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  private update(status: PlaybackState['status'], message = '') {
    this.state = { status, message };
    this.listeners.forEach((listener) => listener());
  }
  stop = () => {
    this.generation++;
    clearTimeout(this.timer);
    this.cancelVoiceWait?.();
    this.cancelVoiceWait = undefined;
    this.pending = undefined;
    this.audio?.pause();
    this.audio = undefined;
    this.engine()?.cancel();
    this.utterance = undefined;
    this.update('idle');
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
        if (ticket === this.generation) this.update('playing');
      };
      utterance.onend = () => {
        if (ticket !== this.generation) return;
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
        this.update('error', '这次播放没有成功，请重播或切换英语音色。');
      };
      this.utterance = utterance;
      engine.resume();
      this.update('playing');
      engine.speak(utterance);
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
  ) {
    this.stop();
    const ticket = this.generation;
    this.update('loading');
    try {
      let url = pronunciationCache.get(word.toLowerCase());
      if (!url) {
        const response = await fetch(
          `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
          { signal: AbortSignal.timeout(4000) },
        );
        if (!response.ok) throw new Error('No recording');
        const entries = (await response.json()) as Array<{
          phonetics?: Array<{ audio?: string }>;
        }>;
        url = entries
          .flatMap((entry) => entry.phonetics ?? [])
          .map((item) => item.audio)
          .find(
            (item) => item?.startsWith('https://') || item?.startsWith('//'),
          );
        if (!url) throw new Error('No recording');
        if (url.startsWith('//')) url = `https:${url}`;
        pronunciationCache.set(word.toLowerCase(), url);
      }
      if (ticket !== this.generation) return;
      const audio = new Audio(url);
      this.audio = audio;
      const fallback = () => {
        if (ticket === this.generation) void this.play(word, preferences);
      };
      audio.onended = () => {
        if (ticket === this.generation) {
          clearTimeout(this.timer);
          this.update('idle');
        }
      };
      audio.onerror = fallback;
      this.timer = setTimeout(fallback, 4000);
      await audio.play();
      if (ticket !== this.generation) {
        audio.pause();
        return;
      }
      clearTimeout(this.timer);
      this.update('playing');
    } catch {
      if (ticket === this.generation) void this.play(word, preferences);
    }
  }
}

const pronunciationCache = new Map<string, string>();
export const speechPlayer = new SpeechPlayer();
