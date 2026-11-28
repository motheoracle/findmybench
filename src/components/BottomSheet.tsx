import { useEffect, useRef, type ReactNode, type PointerEvent } from 'react';

export type SheetState = 'peek' | 'half' | 'full';

const ORDER: SheetState[] = ['peek', 'half', 'full'];

/** Snap heights as a fraction of the viewport (peek is a fixed pixel height). */
function heightFor(state: SheetState): number {
  const vh = window.innerHeight;
  if (state === 'peek') return 148;
  if (state === 'half') return Math.round(vh * 0.5);
  return Math.round(vh - 72);
}

/**
 * Mobile bottom sheet with drag-to-snap. On >=768px the same children render in the sidebar
 * instead (see App), so this component only handles small screens.
 */
export default function BottomSheet({
  state,
  onState,
  resetKey,
  header,
  children,
}: {
  state: SheetState;
  onState(s: SheetState): void;
  resetKey?: string | number;
  header?: ReactNode;
  children: ReactNode;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const prevStateRef = useRef<SheetState>(state);
  const prevResetKeyRef = useRef<string | number | undefined>(resetKey);
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);

  useEffect(() => {
    const prevState = prevStateRef.current;
    const prevKey = prevResetKeyRef.current;
    prevStateRef.current = state;
    prevResetKeyRef.current = resetKey;

    if (state === 'peek') return;
    const keyChanged = resetKey !== prevKey;
    const expandedFromPeek = prevState === 'peek';

    if (keyChanged || expandedFromPeek) {
      const body = bodyRef.current;
      if (body) body.scrollTop = 0;
    }
  }, [resetKey, state]);

  const onDown = (e: PointerEvent) => {
    const el = sheetRef.current;
    if (!el) return;
    drag.current = { y: e.clientY, h: el.getBoundingClientRect().height, moved: false };
    (e.target as Element).setPointerCapture(e.pointerId);
    el.style.transition = 'none';
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    const el = sheetRef.current;
    if (!d || !el) return;
    const dy = d.y - e.clientY;
    if (Math.abs(dy) > 4) d.moved = true;
    const h = Math.min(window.innerHeight - 56, Math.max(110, d.h + dy));
    el.style.height = `${h}px`;
  };
  const onUp = () => {
    const d = drag.current;
    const el = sheetRef.current;
    drag.current = null;
    if (!d || !el) return;
    el.style.transition = '';
    if (!d.moved) {
      // tap on handle cycles state
      onState(ORDER[(ORDER.indexOf(state) + 1) % ORDER.length]);
      el.style.height = '';
      return;
    }
    const h = el.getBoundingClientRect().height;
    const nearest = ORDER.reduce((best, s) =>
      Math.abs(heightFor(s) - h) < Math.abs(heightFor(best) - h) ? s : best,
    );
    el.style.height = '';
    onState(nearest);
  };

  return (
    <div ref={sheetRef} className={`sheet sheet-${state}`}>
      <div
        className="sheet-handle"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        role="button"
        aria-label="Resize panel"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onState(ORDER[(ORDER.indexOf(state) + 1) % ORDER.length]);
        }}
      >
        <span />
        {header}
      </div>
      <div ref={bodyRef} className="sheet-body">{children}</div>
    </div>
  );
}