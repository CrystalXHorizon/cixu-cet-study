import { cachedPronunciation, preparePronunciation } from './pronunciation.ts';

export type AudioPreferences = { voiceURI: string; rate: number };
export const DEFAULT_AUDIO: AudioPreferences = { voiceURI: '', rate: 0.95 };
export type PlaybackState = {
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'error';
  message: string;
  retryable?: boolean;
  notice?: string;
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
    (voice.localService === true ? 1000 : 0) +
    (/natural|neural|enhanced|premium/i.test(voice.name) ? 100 : 0) +
    (/Google/i.test(voice.name) ? 30 : 0) +
    (/^en[-_]US$/i.test(voice.lang) ? 10 : 0) +
    (voice.default ? 5 : 0);
  return voices
    .filter((voice) => /^en(?:[-_]|$)/i.test(voice.lang))
    .sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
}

export function chooseEnglishVoice(
  voices: SpeechSynthesisVoice[],
  voiceURI = '',
) {
  const english = englishVoices(voices);
  const local = english.filter((voice) => voice.localService === true);
  const eligible = local.length ? local : english;
  return eligible.find((voice) => voice.voiceURI === voiceURI) ?? eligible[0];
}

const ONLINE_NOTICE =
  '这台设备没有可用的本地英语语音，已改用在线发音。网络慢时可能会等一会儿。';
const LOCAL_FAILED_NOTICE =
  '本地发音暂时用不了，已改用在线发音。网络慢时可能会等一会儿。';

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
  private notice = '';
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;
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
    this.state = { status, message, retryable, notice: this.notice };
    this.listeners.forEach((listener) => listener());
  }
  stop = () => {
    this.generation++;
    clearTimeout(this.timer);
    clearTimeout(this.noticeTimer);
    this.notice = '';
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
  private showOnlineNotice(message: string) {
    this.notice = message;
    clearTimeout(this.noticeTimer);
    this.update(this.state.status, this.state.message, this.state.retryable);
    this.noticeTimer = setTimeout(() => {
      this.notice = '';
      this.update(this.state.status, this.state.message, this.state.retryable);
    }, 8000);
  }
  private readVoices():
    | SpeechSynthesisVoice[]
    | Promise<SpeechSynthesisVoice[]> {
    const engine = this.engine();
    if (!engine) return [];
    const voices = englishVoices(engine.getVoices());
    if (voices.length) return voices;
    return new Promise((resolve) => {
      const complete = () => {
        clearTimeout(timer);
        engine.removeEventListener('voiceschanged', changed);
        this.cancelVoiceWait = undefined;
        resolve(englishVoices(engine.getVoices()));
      };
      const changed = () => {
        if (englishVoices(engine.getVoices()).length) complete();
      };
      const timer = setTimeout(complete, 1200);
      this.cancelVoiceWait = complete;
      engine.addEventListener('voiceschanged', changed);
    });
  }
  async play(
    text: string,
    preferences: AudioPreferences = this.preferences,
    repetitions = 1,
    onFailure?: () => void,
  ) {
    this.stop();
    const engine = this.engine();
    if (!engine) {
      this.update('error', '当前浏览器不支持朗读，请换用支持语音的浏览器。');
      return;
    }
    const ticket = this.generation;
    this.update('loading');
    const available = this.readVoices();
    const voices = Array.isArray(available) ? available : await available;
    if (ticket !== this.generation) return;
    if (!voices.length) {
      if (onFailure) {
        onFailure();
        return;
      }
      this.update('error', '这里暂时没有能读英语的声音，请换个浏览器试试。');
      return;
    }
    this.voiceCache = voices;
    if (chooseEnglishVoice(voices, preferences.voiceURI)?.localService !== true)
      this.showOnlineNotice(ONLINE_NOTICE);
    let remaining = Math.max(1, Math.min(3, repetitions));
    const next = () => {
      if (ticket !== this.generation) return;
      const utterance = this.createUtterance(text.replace(/\s+/g, ' ').trim());
      const voice = chooseEnglishVoice(this.voiceCache, preferences.voiceURI);
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
        if (onFailure) {
          onFailure();
          return;
        }
        this.retryAction = () => void this.play(text, preferences, repetitions);
        this.update('error', '这次没能发出声音，请再点一次播放。', true);
      };
      this.utterance = utterance;
      engine.resume();
      this.update('loading', '正在启动英语语音…');
      this.timer = setTimeout(() => {
        if (ticket !== this.generation) return;
        this.stop();
        if (onFailure) {
          onFailure();
          return;
        }
        this.retryAction = () => void this.play(text, preferences, repetitions);
        this.update(
          'error',
          '等了一会儿还是没声音，请再试一次，或换个浏览器。',
          true,
        );
      }, 5000);
      try {
        engine.speak(utterance);
      } catch {
        clearTimeout(this.timer);
        if (onFailure) {
          onFailure();
          return;
        }
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
  ) {
    this.stop();
    const ticket = this.generation;
    this.update('loading', '正在准备发音…');
    const available = this.readVoices();
    const voices = Array.isArray(available) ? available : await available;
    if (ticket !== this.generation) return;
    const local = voices.filter((voice) => voice.localService === true);
    if (local.length) {
      const voice = chooseEnglishVoice(local, preferences.voiceURI)!;
      return this.play(
        word,
        { ...preferences, voiceURI: voice.voiceURI },
        1,
        () => void this.playOnlineWord(word, preferences, LOCAL_FAILED_NOTICE),
      );
    }
    return this.playOnlineWord(word, preferences);
  }
  private async playOnlineWord(
    word: string,
    preferences: AudioPreferences = this.preferences,
    notice = ONLINE_NOTICE,
  ) {
    this.stop();
    const ticket = this.generation;
    this.showOnlineNotice(notice);
    this.update('loading', `正在准备 ${word} 的发音…`);
    try {
      // Cached recordings start within the click, retaining browser user activation.
      const recording =
        cachedPronunciation(word) ?? (await preparePronunciation(word));
      if (ticket !== this.generation) return;
      const audio = this.createAudio(recording.url);
      this.audio = audio;
      audio.volume = 1;
      audio.muted = false;
      const fallback = () => {
        if (ticket === this.generation) {
          clearTimeout(this.timer);
          this.audio?.pause();
          this.retryAction = () =>
            void this.playOnlineWord(word, preferences, notice);
          this.update('error', '在线发音暂时没连上，请稍后再试。', true);
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
            void this.playOnlineWord(word, preferences, notice);
          this.update('error', '声音已经准备好了，请再点一次播放。', true);
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
      if (ticket === this.generation) {
        this.retryAction = () =>
          void this.playOnlineWord(word, preferences, notice);
        this.update('error', '在线发音暂时没连上，请稍后再试。', true);
      }
    }
  }
}

export const speechPlayer = new SpeechPlayer();
