import { useSyncExternalStore } from 'react';
import { LoaderCircle, Play, Volume2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { speechPlayer } from '@/lib/speech-player';

export function PlaybackNotice() {
  const playback = useSyncExternalStore(
    speechPlayer.subscribe,
    speechPlayer.getSnapshot,
    speechPlayer.getSnapshot,
  );
  if (playback.status === 'idle') return null;
  return (
    <aside
      aria-label="发音播放状态"
      className="fixed inset-x-4 bottom-20 z-50 mx-auto flex max-w-xl items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-lg lg:bottom-6"
    >
      {playback.status === 'loading' ? (
        <LoaderCircle className="size-5 shrink-0 animate-spin text-primary" />
      ) : (
        <Volume2 className="size-5 shrink-0 text-primary" />
      )}
      <output className="min-w-0 flex-1 text-sm leading-6">
        {playback.message ||
          (playback.status === 'paused' ? '已暂停' : '正在播放')}
      </output>
      {playback.retryable && (
        <Button size="sm" onClick={speechPlayer.retry}>
          <Play className="size-4" />
          播放
        </Button>
      )}
      <Button
        size="icon"
        variant="ghost"
        aria-label="停止并关闭发音提示"
        onClick={speechPlayer.stop}
      >
        <X />
      </Button>
    </aside>
  );
}
