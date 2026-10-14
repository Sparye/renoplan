import { type FormEvent, useState } from 'react';
import { type Plan, addOutline, addRoom, parseLength } from '@/core';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';

const SAMPLE: [string, number, number][] = [
  ['Living', 5200, 4400],
  ['Kitchen', 3400, 3000],
  ['Dining', 3400, 2800],
  ['Bedroom 1', 3800, 3400],
  ['Bedroom 2', 3200, 3000],
  ['Bedroom 3', 3000, 2900],
  ['Bathroom', 2400, 2100],
  ['Toilet', 900, 1500],
  ['Laundry', 1800, 1700]
];

/** Capture starts with the Outline's outside dimensions (ADR 0007) — or without one. */
export function StartOverlay({ plan, onStart }: { plan: Plan; onStart: (plan: Plan) => void }) {
  const [w, setW] = useState('12.4');
  const [l, setL] = useState('9.2');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const W = parseLength(w);
    const L = parseLength(l);
    if (W && L) onStart(addOutline(plan, W, L, { x: 0, y: 0 }));
  };
  const sample = () => {
    let p = addOutline(plan, 12400, 9200, { x: 0, y: 0 });
    for (const [name, rw, rl] of SAMPLE) p = addRoom(p, { name, w: rw, l: rl }).plan;
    onStart(p);
  };
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-white/70 backdrop-blur-[2px]">
      <form className="bg-background w-[26rem] space-y-4 rounded-xl border p-6 shadow-lg" onSubmit={submit}>
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">How big is the house?</h1>
          <p className="text-muted-foreground text-sm">
            Its outside dimensions, measured over the exterior walls. Metres (12.4) or millimetres (12400).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            aria-label="House width"
            autoFocus
            className="w-28 text-lg"
            value={w}
            onChange={(e) => setW(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
          />
          <span className="text-muted-foreground">×</span>
          <Input
            aria-label="House length"
            className="w-28 text-lg"
            value={l}
            onChange={(e) => setL(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
          />
          <span className="text-muted-foreground text-sm">m</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit">Start</Button>
          <Button type="button" variant="outline" onClick={() => onStart(plan)}>
            Skip — no outline
          </Button>
          <Button type="button" variant="ghost" onClick={sample}>
            Sample house
          </Button>
        </div>
      </form>
    </div>
  );
}
