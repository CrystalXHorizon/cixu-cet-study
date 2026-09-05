import { useState } from 'react';
import { Check, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  findSentenceWord,
  isWordToken,
  normalizeToken,
  sentenceTokens,
  type SentenceMark,
} from '@/lib/sentence-words';
import type { SentenceExample, Word } from '@/lib/words';

export function SentencePicker({
  example,
  word,
  dictionary,
  marks,
  onSave,
  onSpeak,
  compact = false,
}: {
  example: SentenceExample;
  word: Word;
  dictionary: Map<string, Word>;
  marks: SentenceMark[];
  onSave: (example: SentenceExample, marks: SentenceMark[]) => void;
  onSpeak: (token: string) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const tokens = sentenceTokens(example.english);
  const uniqueWords = [
    ...new Map(
      tokens.filter(isWordToken).map((token) => [normalizeToken(token), token]),
    ).values(),
  ];
  const saved = marks.filter(
    (mark) => mark.example.english === example.english,
  );
  const savedKeys = new Set(saved.map((mark) => normalizeToken(mark.token)));

  function openPicker(token?: string) {
    setSelected([
      ...new Set([...savedKeys, ...(token ? [normalizeToken(token)] : [])]),
    ]);
    setOpen(true);
  }

  return (
    <div>
      <p
        className={cn(
          'font-heading text-xl leading-[2.2] sm:text-2xl',
          compact && 'font-sans text-base sm:text-base',
        )}
      >
        {tokens.map((token, index) => {
          if (!isWordToken(token)) return <span key={index}>{token}</span>;
          const marked = savedKeys.has(normalizeToken(token));
          const isTarget = findSentenceWord(token, dictionary)?.id === word.id;
          return (
            <button
              key={index}
              type="button"
              onClick={() => openPicker(token)}
              aria-label={`${token}，${marked ? '已标记不认识，修改标记' : '标记不认识'}`}
              className={cn(
                'rounded px-0.5 text-left transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                isTarget && 'bg-secondary font-semibold text-primary',
                marked &&
                  'decoration-primary underline decoration-dotted underline-offset-8',
              )}
            >
              {token}
            </button>
          );
        })}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <button
          type="button"
          className="rounded text-primary underline underline-offset-4 hover:decoration-2 focus-visible:outline-2 focus-visible:outline-primary"
          onClick={() => openPicker()}
        >
          标记不认识的词
        </button>
        {saved.length > 0 && (
          <output className="text-muted-foreground">
            已标记 {saved.length} 个 · 已保存到错词本
          </output>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto rounded-2xl p-6 sm:max-w-xl sm:p-8">
          <DialogHeader>
            <DialogTitle className="pr-5 text-xl">
              这句话里，哪些词不认识？
            </DialogTitle>
            <DialogDescription className="leading-6">
              点击选中，可以多选；再点一次取消。保存后可在错词本回看原句。
            </DialogDescription>
          </DialogHeader>
          <p className="mt-2 rounded-xl bg-muted/65 p-4 font-heading text-lg leading-8">
            {example.english}
          </p>
          <fieldset
            className="flex min-w-0 flex-wrap gap-2 py-2"
            aria-label="选择不认识的词"
          >
            {uniqueWords.map((token) => {
              const value = normalizeToken(token);
              const checked = selected.includes(value);
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={checked}
                  onClick={() =>
                    setSelected((current) =>
                      checked
                        ? current.filter((item) => item !== value)
                        : [...current, value],
                    )
                  }
                  className={cn(
                    'inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 text-base transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                    checked
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border hover:bg-secondary',
                  )}
                >
                  {token}
                  {checked && <Check className="size-3.5" aria-hidden="true" />}
                </button>
              );
            })}
          </fieldset>
          {selected.length > 0 && (
            <ul className="divide-y divide-border border-y border-border">
              {selected.map((token) => {
                const matched = findSentenceWord(token, dictionary);
                return (
                  <li
                    key={token}
                    className="flex items-start justify-between gap-3 py-3"
                  >
                    <div>
                      <p className="text-base font-medium">
                        {token}
                        {matched && normalizeToken(matched.word) !== token && (
                          <span className="ml-2 text-sm font-normal text-muted-foreground">
                            词形：{matched.word}
                          </span>
                        )}
                      </p>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        {matched
                          ? matched.meaning
                          : '词库暂未收录，将保留这个词和原句。'}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`播放 ${token}`}
                      onClick={() => onSpeak(token)}
                    >
                      <Volume2 />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-sm leading-6 text-muted-foreground">
            词库内的生词会加入到期复习。标记不会计作答错。
          </p>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">
              已选 {selected.length} 个
            </span>
            <Button
              className="h-11 rounded-full px-6"
              onClick={() => {
                onSave(
                  example,
                  selected.map((token) => ({
                    token,
                    example,
                    wordId: findSentenceWord(token, dictionary)?.id,
                  })),
                );
                setOpen(false);
              }}
            >
              保存标记
              <Check data-icon="inline-end" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
