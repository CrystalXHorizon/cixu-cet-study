import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  examSessionLabel,
  examSessionOptions,
  normalizeExamSession,
} from '@/lib/exam-session';

export function ExamSessionSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      value={normalizeExamSession(value)}
      onValueChange={(next) => {
        if (next) onChange(next);
      }}
    >
      <SelectTrigger
        id={id}
        className="h-11 w-full rounded-xl bg-card px-3 text-base"
        aria-label="目标考试场次"
      >
        <SelectValue>{examSessionLabel(value)}</SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {examSessionOptions(value).map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            className="min-h-11 px-3 text-base"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
