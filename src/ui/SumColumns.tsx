import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type MutableRefObject } from 'react';
import { boardSolved, canPlace, columnValue, dealLevel, moveTop, type CubeOp } from '../game/flaskLogic';

type Flight = {
  value: number;
  face: number;
  x: number;
  y: number;
  w: number;
  h: number;
  dx: number;
  dy: number;
  run: boolean;
  to: number;
};

type Snapshot = { columns: number[][]; faces: number[][] };

type Fit = { cube: number; gap: number; colGap: number; rowGap: number; top: number; bottom: number; rowSizes: number[] };

const CUBE_FACES = [
  { src: '/cubes/yellow.png', ink: '#3b2508', darkInk: true },
  { src: '/cubes/pink.png', ink: '#fffafc', darkInk: false },
  { src: '/cubes/orange.png', ink: '#fffaf5', darkInk: false },
  { src: '/cubes/green.png', ink: '#14300a', darkInk: true },
  { src: '/cubes/blue.png', ink: '#f8fafc', darkInk: false },
];

function paintColumns(columns: number[][]): number[][] {
  return columns.map((col) => col.map(() => Math.floor(Math.random() * CUBE_FACES.length)));
}

function CubeFace({
  value,
  face,
  id,
  selected,
  interactive,
  hidden,
  fontSize,
  onClick,
}: {
  value: number;
  face: number;
  id?: string;
  selected?: boolean;
  interactive?: boolean;
  hidden?: boolean;
  fontSize: number;
  onClick?: (event: MouseEvent) => void;
}) {
  const paint = CUBE_FACES[face] ?? CUBE_FACES[0];
  return (
    <div
      id={id}
      onClick={onClick}
      className={`relative flex h-full w-full items-center justify-center font-black ${
        interactive ? 'cursor-pointer' : 'pointer-events-none'
      }`}
      style={{
        visibility: hidden ? 'hidden' : 'visible',
        fontSize,
        color: paint.ink,
        filter: selected
          ? 'drop-shadow(0 0 5px rgba(224,242,254,0.95)) drop-shadow(0 4px 6px rgba(0,0,0,0.45))'
          : 'drop-shadow(0 3px 4px rgba(0,0,0,0.4))',
      }}
    >
      <img src={paint.src} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain" />
      <span
        className="pointer-events-none absolute inset-0 flex items-center justify-center leading-none"
        style={{
          textShadow: paint.darkInk
            ? '0 1px 0 rgba(255,255,255,0.35)'
            : '0 1px 2px rgba(15,23,42,0.8), 0 0 8px rgba(15,23,42,0.45)',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function OpMark({ op, size }: { op: 'mul' | 'sum'; size: number }) {
  const color = op === 'mul' ? '#67E8F9' : '#FFE14A';
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className="drop-shadow-[0_1px_0_rgba(15,23,42,0.85)]" style={{ color }}>
      <path
        d={op === 'mul' ? 'M3.1 3.1l9.8 9.8M12.9 3.1L3.1 12.9' : 'M8 2.2v11.6M2.2 8h11.6'}
        fill="none"
        stroke="currentColor"
        strokeWidth={3.6}
        strokeLinecap="round"
      />
    </svg>
  );
}

function measureBoard(perRow: number, bands: number, cubeRows: number, availW: number, availH: number) {
  let cube = 48;
  let gap = 6;
  let colGap = 8;
  let rowGap = 12;
  for (let i = 0; i < 6; i++) {
    colGap = Math.max(4, Math.min(12, Math.round(cube * 0.22)));
    gap = Math.max(14, Math.min(22, Math.round(cube * 0.58) - 6));
    rowGap = Math.max(10, Math.min(18, Math.round(cube * 0.4)));
    const byW = Math.floor((availW - colGap * Math.max(0, perRow - 1)) / Math.max(1, perRow)) - 14;
    const badgeH = Math.round((cube + 14) * (24 / 72)) + 4;
    const chrome = bands * (16 + badgeH) + Math.max(0, bands - 1) * rowGap + bands * Math.max(0, cubeRows - 1) * gap;
    const byH = Math.floor((availH - chrome) / Math.max(1, bands * cubeRows));
    cube = Math.max(16, Math.min(48, byW, byH));
  }
  return { cube, gap, colGap, rowGap };
}

/** Pick one row, or two or three, whichever keeps the cubes largest on this screen. */
function fitBoard(totalCols: number, cubeRows: number): Fit {
  const top = document.getElementById('hud-top')?.offsetHeight ?? 108;
  const bottom = document.getElementById('hud-bottom')?.offsetHeight ?? 84;
  const availH = Math.max(80, window.innerHeight - top - bottom - 12);
  const availW = Math.max(80, window.innerWidth - 16);
  let best = { ...measureBoard(totalCols, 1, cubeRows, availW, availH), bands: 1 };
  const maxBands = Math.min(totalCols, 3);
  for (let bands = 2; bands <= maxBands; bands++) {
    const perRow = Math.ceil(totalCols / bands);
    const next = measureBoard(perRow, bands, cubeRows, availW, availH);
    if (next.cube > best.cube + 1) best = { ...next, bands };
  }
  const base = Math.floor(totalCols / best.bands);
  const extra = totalCols % best.bands;
  const rowSizes = Array.from({ length: best.bands }, (_, index) => base + (index < extra ? 1 : 0));
  return { cube: best.cube, gap: best.gap, colGap: best.colGap, rowGap: best.rowGap, top, bottom, rowSizes };
}

export function SumColumns({
  level,
  undoRef,
  addColumnRef,
  onMove,
  onSolved,
  onCanUndo,
  onExtraReady,
}: {
  /** 0-based round from the shell. The flask game's levels start at 1. */
  level: number;
  undoRef: MutableRefObject<(() => void) | null>;
  addColumnRef: MutableRefObject<(() => boolean) | null>;
  onMove: () => void;
  onSolved: () => void;
  onCanUndo: (can: boolean) => void;
  onExtraReady: (left: number) => void;
}) {
  const gameLevel = level + 1;
  const dealt = useRef(dealLevel(gameLevel));
  const [columns, setColumns] = useState<number[][]>(() => dealt.current.columns.map((col) => [...col]));
  const [faces, setFaces] = useState<number[][]>(() => paintColumns(dealt.current.columns));
  const [targets] = useState<number[]>(() => [...dealt.current.targets]);
  const [ops] = useState<CubeOp[][]>(() => dealt.current.ops.map((column) => [...column]));
  const [flaskCount] = useState(() => dealt.current.flaskCount);
  const [ballCount] = useState(() => dealt.current.ballCount);
  const [selected, setSelected] = useState<number | null>(null);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [flight, setFlight] = useState<Flight | null>(null);
  const columnsRef = useRef(columns);
  const solvedRef = useRef(false);
  columnsRef.current = columns;
  const [fit, setFit] = useState<Fit>(() => fitBoard(dealt.current.columns.length, dealt.current.ballCount));

  useLayoutEffect(() => {
    const update = () => setFit(fitBoard(columnsRef.current.length, ballCount));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [columns.length, ballCount]);

  useEffect(() => {
    onExtraReady(2);
  }, [onExtraReady]);

  useEffect(() => {
    onCanUndo(history.length > 0 && !flight);
  }, [history.length, flight, onCanUndo]);

  useEffect(() => {
    undoRef.current = () => {
      if (flight) return;
      setHistory((stack) => {
        const prev = stack[stack.length - 1];
        if (!prev) return stack;
        setColumns((current) => {
          const restored = prev.columns.map((col) => [...col]);
          for (let i = restored.length; i < current.length; i++) restored.push([]);
          return restored;
        });
        setFaces((current) => {
          const restored = prev.faces.map((col) => [...col]);
          for (let i = restored.length; i < current.length; i++) restored.push([]);
          return restored;
        });
        setSelected(null);
        return stack.slice(0, -1);
      });
    };
    return () => {
      undoRef.current = null;
    };
  }, [undoRef, flight]);

  useEffect(() => {
    addColumnRef.current = () => {
      if (flight) return false;
      setColumns((current) => [...current.map((col) => [...col]), []]);
      setFaces((current) => [...current.map((col) => [...col]), []]);
      return true;
    };
    return () => {
      addColumnRef.current = null;
    };
  }, [addColumnRef, flight]);

  const finishFlight = () => {
    setFlight(null);
    if (!solvedRef.current && boardSolved(columnsRef.current, targets, flaskCount, ballCount, ops)) {
      solvedRef.current = true;
      onSolved();
    }
  };

  useEffect(() => {
    if (!flight?.run) return;
    const timer = window.setTimeout(() => finishFlight(), 420);
    return () => window.clearTimeout(timer);
  }, [flight?.run]);

  const place = (from: number, to: number) => {
    if (flight || !canPlace(columns[to] ?? [], ballCount)) return;
    const source = columns[from];
    if (!source?.length) return;
    const value = source[0];
    const face = faces[from]?.[0] ?? 0;
    const cubeEl = document.getElementById(`sum-top-${from}`);
    const landEl = document.getElementById(`sum-land-${to}`);
    if (!cubeEl || !landEl) return;
    const fromBox = cubeEl.getBoundingClientRect();
    const landBox = landEl.getBoundingClientRect();
    const next = moveTop(columns, from, to, ballCount);
    if (!next) return;
    setHistory((stack) => [...stack, {
      columns: columns.map((col) => [...col]),
      faces: faces.map((col) => [...col]),
    }]);
    setColumns(next);
    setFaces((current) => {
      const nextFaces = current.map((col) => [...col]);
      while (nextFaces.length < next.length) nextFaces.push([]);
      const moving = nextFaces[from]?.shift() ?? face;
      nextFaces[to] = nextFaces[to] ?? [];
      nextFaces[to].unshift(moving);
      return nextFaces;
    });
    setSelected(null);
    onMove();
    setFlight({
      value,
      face,
      x: fromBox.left,
      y: fromBox.top,
      w: fromBox.width,
      h: fromBox.height,
      dx: landBox.left - fromBox.left,
      dy: landBox.top - fromBox.top,
      run: false,
      to,
    });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setFlight((current) => (current ? { ...current, run: true } : current));
      });
    });
  };

  const onColumn = (index: number) => {
    if (flight) return;
    if (selected == null) {
      if (!columns[index]?.length) return;
      setSelected(index);
      return;
    }
    if (selected === index) {
      setSelected(null);
      return;
    }
    if (!canPlace(columns[index] ?? [], ballCount)) return;
    place(selected, index);
  };

  const badgeH = Math.round((fit.cube + 14) * (24 / 72));
  const rowSizes = fit.rowSizes.reduce((sum, count) => sum + count, 0) === columns.length ? fit.rowSizes : [columns.length];
  const bands: { col: number[]; index: number }[][] = [];
  let cursor = 0;
  for (const count of rowSizes) {
    const row = columns.slice(cursor, cursor + count).map((col, offset) => ({ col, index: cursor + offset }));
    bands.push(row);
    cursor += count;
  }

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[5] flex items-center justify-center overflow-hidden px-2"
      style={{ top: fit.top, bottom: fit.bottom }}
    >
      <div className="pointer-events-auto flex max-h-full max-w-full flex-col items-center justify-center" style={{ gap: fit.rowGap }}>
        {bands.map((row, rowIndex) => (
          <div key={rowIndex} className="flex items-end justify-center" style={{ gap: fit.colGap }}>
        {row.map(({ col, index }) => {
          const target = targets[index];
          const columnOps = ops[index];
          const now = columnOps ? columnValue(col, ballCount, columnOps) : col.reduce((sum, n) => sum + n, 0);
          const full = col.length >= ballCount;
          const slots: (number | null)[] = [
            ...Array.from({ length: ballCount - col.length }, () => null),
            ...col,
          ];
          return (
            <div key={index} className="flex shrink-0 flex-col items-center" style={{ width: fit.cube + 14 }}>
              <div
                onClick={() => onColumn(index)}
                className={`flex w-full flex-col rounded-md border border-transparent bg-slate-900/45 px-1.5 py-2 ${
                  full && selected != null && selected !== index ? 'opacity-60' : ''
                }`}
                style={{ gap: fit.gap }}
              >
                {slots.map((value, slot) => {
                  const isTop = value != null && slot === ballCount - col.length;
                  const isLanding = value == null && slot === ballCount - col.length - 1;
                  const hidden = value != null && !!flight && isTop && flight.to === index && flight.value === value;
                  return (
                    <div
                      key={`${index}-${slot}-${value ?? 'empty'}`}
                      className="relative w-full"
                      style={{ height: fit.cube }}
                    >
                      {value == null ? (
                        <div
                          id={isLanding ? `sum-land-${index}` : undefined}
                          className="h-full w-full bg-slate-950/30"
                          style={{ borderRadius: '22%' }}
                        />
                      ) : (
                        <CubeFace
                          id={isTop ? `sum-top-${index}` : undefined}
                          value={value}
                          face={faces[index]?.[slot - (ballCount - col.length)] ?? 0}
                          selected={isTop && selected === index}
                          interactive={isTop}
                          hidden={hidden}
                          fontSize={Math.max(11, Math.round(fit.cube * 0.42))}
                          onClick={isTop ? (event) => { event.stopPropagation(); onColumn(index); } : undefined}
                        />
                      )}
                      {columnOps && col.length > 0 && slot < ballCount - 1 && (
                        <div
                          className="pointer-events-none absolute inset-x-0 z-[1] flex -translate-y-1/2 justify-center text-white"
                          style={{ top: `calc(100% + ${fit.gap / 2}px)` }}
                        >
                          <OpMark op={columnOps[slot] === 'mul' ? 'mul' : 'sum'} size={Math.max(11, Math.round((fit.gap + 6) * 0.46))} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="relative mt-1 w-full" style={{ height: badgeH }}>
                <img src="/ui/sum.svg" alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full select-none" />
                <span
                  className="pointer-events-none absolute inset-0 flex items-center justify-center font-extrabold leading-none text-[#F9F2DD] [text-shadow:0_1px_0_#3B0A00]"
                  style={{ fontSize: Math.max(11, Math.round(badgeH * 0.5) + 2) }}
                >
                  {target != null ? `${now}/${target}` : now}
                </span>
              </div>
            </div>
          );
        })}
          </div>
        ))}
      </div>
      {flight && (
        <div
          className="pointer-events-none fixed z-20"
          style={{
            left: flight.x,
            top: flight.y,
            width: flight.w,
            height: flight.h,
            transform: flight.run ? `translate(${flight.dx}px, ${flight.dy}px)` : 'none',
            transition: flight.run ? 'transform 320ms cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none',
          }}
          onTransitionEnd={finishFlight}
        >
          <CubeFace value={flight.value} face={flight.face} selected fontSize={Math.max(11, Math.round(flight.h * 0.42))} />
        </div>
      )}
    </div>
  );
}
