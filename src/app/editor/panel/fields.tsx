import { type KeyboardEvent, type Ref, useId, useMemo, useState } from 'react';
import { type Mm, formatMetres, parseLength } from '@/core';
import { Input } from '@/app/components/ui/input';
import { cn } from '@/app/lib/utils';

export const ROOM_NAMES = [
  'Living',
  'Kitchen',
  'Dining',
  'Bedroom 1',
  'Bedroom 2',
  'Bedroom 3',
  'Bathroom',
  'Ensuite',
  'Toilet',
  'Laundry',
  'Hallway',
  'Entry',
  'Study',
  'Pantry',
  'Garage'
];

/** A length shown in metres; accepts metres or millimetres ("3.6", "3600", "3600mm") and commits on blur or Enter. */
export function LengthField(props: {
  value: Mm;
  onCommit: (mm: Mm) => void;
  label?: string;
  unit?: 'm' | 'mm';
  className?: string;
  'aria-label'?: string;
}) {
  const unit = props.unit ?? 'm';
  const show = (v: Mm) => (unit === 'm' ? formatMetres(v) : String(v));
  // What the user is typing; null when not editing, so the field always shows the current value.
  const [draft, setDraft] = useState<string | null>(null);
  const done = () => {
    const text = draft ?? '';
    setDraft(null);
    const v = unit === 'mm' && /^\d+$/.test(text.trim()) ? Number(text.trim()) : parseLength(text);
    if (v && v !== props.value) props.onCommit(v);
  };
  const id = useId();
  return (
    <div className={cn('flex items-center gap-1.5', props.className)}>
      {props.label && (
        <label htmlFor={id} className="text-muted-foreground w-4 text-xs">
          {props.label}
        </label>
      )}
      <Input
        id={id}
        aria-label={props['aria-label'] ?? props.label}
        className="h-8 w-20 px-2 text-right tabular-nums"
        value={draft ?? show(props.value)}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => {
          setDraft(show(props.value));
          e.currentTarget.select();
        }}
        onBlur={done}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setDraft(show(props.value));
            e.currentTarget.blur();
          }
        }}
      />
      <span className="text-muted-foreground text-xs">{unit}</span>
    </div>
  );
}

/**
 * A Room name with suggestions that still accepts free text. Arrow keys move through the suggestions;
 * Enter takes the highlighted one, otherwise Enter is left to the surrounding form.
 */
export function NameCombobox({
  ref,
  ...props
}: {
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
  ref?: Ref<HTMLInputElement>;
  autoFocus?: boolean;
  className?: string;
  onBlur?: () => void;
  onEnter?: () => void;
  'aria-label'?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const matches = useMemo(() => {
    const q = props.value.trim().toLowerCase();
    return ROOM_NAMES.filter((n) => n.toLowerCase().includes(q) && n.toLowerCase() !== q).slice(0, 7);
  }, [props.value]);
  const show = open && matches.length > 0;
  const pick = (name: string) => {
    props.onChange(name);
    setOpen(false);
    setActive(-1);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && matches.length) {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a + 1) % matches.length);
    } else if (e.key === 'ArrowUp' && matches.length) {
      e.preventDefault();
      setActive((a) => (a <= 0 ? matches.length - 1 : a - 1));
    } else if (e.key === 'Enter') {
      if (show && active >= 0) {
        e.preventDefault();
        pick(matches[active]!);
      } else if (props.onEnter) {
        // The caller handles Enter (it may submit the form itself), so the browser must not.
        e.preventDefault();
        setOpen(false);
        props.onEnter();
      } else setOpen(false);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };
  return (
    <div className={cn('relative', props.className)}>
      <Input
        ref={ref}
        role="combobox"
        aria-label={props['aria-label']}
        aria-expanded={show}
        aria-controls={listId}
        autoFocus={props.autoFocus}
        autoComplete="off"
        className="h-8"
        placeholder={props.placeholder}
        value={props.value}
        onChange={(e) => {
          props.onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={(e) => {
          setOpen(true);
          e.currentTarget.select();
        }}
        onBlur={() => {
          setOpen(false);
          props.onBlur?.();
        }}
        onKeyDown={onKeyDown}
      />
      {show && (
        <ul
          id={listId}
          role="listbox"
          className="bg-popover text-popover-foreground absolute top-full left-0 z-50 mt-1 w-full overflow-hidden rounded-md border p-1 shadow-md"
        >
          {matches.map((m, i) => (
            <li
              key={m}
              role="option"
              aria-selected={i === active}
              className={cn(
                'cursor-default rounded-sm px-2 py-1.5 text-sm',
                i === active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(m);
              }}
            >
              {m}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Section(props: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5 border-b px-4 py-4 last:border-b-0">
      <h2 className="flex items-baseline justify-between text-sm font-semibold">
        {props.title}
        {props.hint && <small className="text-muted-foreground font-normal">{props.hint}</small>}
      </h2>
      {props.children}
    </section>
  );
}

export const Hint = ({ children }: { children: React.ReactNode }) => (
  <p className="text-muted-foreground text-xs leading-relaxed">{children}</p>
);
