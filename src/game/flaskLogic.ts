/**
 * Short columns come first and use only + or only ×, because one gap cannot hold both.
 * Taller columns, the ones that show up in medium, hard, and very hard, mix + and ×
 * inside most columns. A column needs at least 3 cubes before it can hold both signs.
 */

interface BoardSize {
  columns: number;
  cubes: number;
}

const SIZES: BoardSize[] = [
  { columns: 2, cubes: 2 },
  { columns: 3, cubes: 2 },
  { columns: 4, cubes: 2 },
  { columns: 3, cubes: 3 },
  { columns: 5, cubes: 2 },
  { columns: 4, cubes: 3 },
  { columns: 6, cubes: 2 },
  { columns: 5, cubes: 3 },
  { columns: 4, cubes: 4 },
  { columns: 7, cubes: 2 },
  { columns: 6, cubes: 3 },
  { columns: 5, cubes: 4 },
  { columns: 7, cubes: 3 },
  { columns: 6, cubes: 4 },
  { columns: 5, cubes: 5 },
  { columns: 7, cubes: 4 },
  { columns: 6, cubes: 5 },
  { columns: 7, cubes: 5 },
  { columns: 6, cubes: 6 },
  { columns: 7, cubes: 6 },
  { columns: 7, cubes: 7 },
];

function columnOf(gaps: number, sign: '+' | '*'): string {
  return sign.repeat(gaps);
}

function allPlus(columns: number, gaps: number): string {
  return Array.from({ length: columns }, () => columnOf(gaps, '+')).join('|');
}

/** Some columns +, the rest ×. Skips a layout that is all one sign or a repeat. */
function splitLayouts(columns: number, gaps: number): string[] {
  const masks: boolean[][] = [
    Array.from({ length: columns }, (_, index) => index === 0),
    Array.from({ length: columns }, (_, index) => index === columns - 1),
  ];
  if (columns >= 3) masks.push(Array.from({ length: columns }, (_, index) => index % 2 === 0));
  if (columns >= 4) masks.push(Array.from({ length: columns }, (_, index) => index < Math.floor(columns / 2)));
  const seen = new Set<string>();
  const layouts: string[] = [];
  for (const mask of masks) {
    if (mask.every(Boolean) || mask.every((plus) => !plus)) continue;
    const pattern = mask.map((plus) => columnOf(gaps, plus ? '+' : '*')).join('|');
    if (seen.has(pattern)) continue;
    seen.add(pattern);
    layouts.push(pattern);
  }
  return layouts.slice(0, 3);
}

/** Every way to place both + and × in one column. */
function mixedSigns(gaps: number): string[] {
  const signs: string[] = [];
  const total = 1 << gaps;
  for (let mask = 1; mask < total - 1; mask++) {
    let column = '';
    for (let gap = 0; gap < gaps; gap++) column += mask & (1 << gap) ? '*' : '+';
    signs.push(column);
  }
  return signs;
}

/** Most columns on the board contain both signs, and neighbors do not share one pattern. */
function combinationLayouts(columns: number, gaps: number): string[] {
  const signs = mixedSigns(gaps);
  const seen = new Set<string>();
  const layouts: string[] = [];
  const add = (row: string[]) => {
    if (signs.length > 1 && new Set(row).size === 1) return;
    const pattern = row.join('|');
    if (seen.has(pattern)) return;
    const mixed = row.filter((column) => column.includes('+') && column.includes('*')).length;
    if (mixed < Math.ceil(columns * 0.75)) return;
    seen.add(pattern);
    layouts.push(pattern);
  };
  for (let variant = 0; layouts.length < 10 && variant < 120; variant++) {
    const row = Array.from({ length: columns }, (_, index) => {
      const pick = (index * (3 + (variant % 5)) + variant * 7 + index * variant) % signs.length;
      return signs[pick];
    });
    add(row);
  }
  return layouts;
}

interface BuiltLevel {
  pattern: string;
  mechanic: 0 | 1 | 2 | 3;
  size: 0 | 1 | 2 | 3;
}

function buildLevels(): BuiltLevel[] {
  const patterns: string[] = [];
  const short = SIZES.filter((size) => size.cubes < 3);
  const tall = SIZES.filter((size) => size.cubes >= 3);
  for (const { columns, cubes } of short) {
    const gaps = cubes - 1;
    patterns.push(allPlus(columns, gaps));
    patterns.push(...splitLayouts(columns, gaps));
  }
  for (const { columns, cubes } of tall) {
    const gaps = cubes - 1;
    if (columns === 3 && cubes === 3) {
      patterns.push(allPlus(columns, gaps));
      patterns.push(...splitLayouts(columns, gaps).slice(0, 1));
    }
    patterns.push(...combinationLayouts(columns, gaps));
  }
  const base = patterns.map((pattern, index) => {
    const slice = Math.min(15, Math.floor((index / patterns.length) * 16));
    return {
      pattern,
      mechanic: Math.floor(slice / 4) as 0 | 1 | 2 | 3,
      size: (slice % 4) as 0 | 1 | 2 | 3,
    };
  });
  const pool = base.filter((level) => level.mechanic === 1 || level.mechanic === 2);
  const extra: BuiltLevel[] = [];
  for (let i = 0; i < 100; i++) {
    const source = pool[i % pool.length];
    extra.push({ pattern: source.pattern, mechanic: 3, size: source.size });
  }
  return [...base, ...extra];
}

const LEVELS = buildLevels();

export const LEVEL_COUNT = LEVELS.length;

export type CubeOp = 'sum' | 'mul';

/** First word of the level name. It only moves forward through the campaign. */
export function tierOf(level: number): 0 | 1 | 2 | 3 {
  const index = Math.min(LEVEL_COUNT, Math.max(1, level)) - 1;
  return LEVELS[index].mechanic;
}

/** Second status: easy, medium, hard, very hard as the board grows inside that lesson. */
export function sizeBandOf(level: number): 0 | 1 | 2 | 3 {
  const index = Math.min(LEVEL_COUNT, Math.max(1, level)) - 1;
  return LEVELS[index].size;
}

function parseLevel(pattern: string): CubeOp[][] {
  const columns = pattern.split('|').map((column) =>
    [...column].map((sign) => (sign === '*' ? 'mul' : 'sum')),
  );
  const gaps = columns[0]?.length ?? 0;
  if (gaps < 1 || columns.some((column) => column.length !== gaps)) {
    throw new Error(`Every column in a level must be the same full height: ${pattern}`);
  }
  return columns;
}

/** Top to bottom. × is done before +, so 2+1×2+3+1×1 is 8 and 2+3×5×2+1+2×2 is 37. */
export function columnValue(col: number[], ballCount: number, ops: CubeOp[]): number {
  if (!col.length) return 0;
  const gap = ballCount - col.length;
  let total = 0;
  let product = col[0];
  for (let i = 1; i < col.length; i++) {
    const op = ops[gap + i - 1] ?? 'sum';
    if (op === 'mul') product *= col[i];
    else {
      total += product;
      product = col[i];
    }
  }
  return total + product;
}

function fillColumn(ops: CubeOp[], tier: number): number[] {
  const max = tier === 0 ? 5 : tier === 1 ? 6 : 7;
  const roll = (min: number) => min + Math.floor(Math.random() * (max - min + 1));
  const numbers: number[] = [];
  for (let i = 0; i < ops.length + 1; i++) {
    const touchesMul = ops[i] === 'mul' || ops[i - 1] === 'mul';
    numbers.push(roll(touchesMul ? 2 : 1));
  }
  return numbers;
}

export interface FlaskDeal {
  columns: number[][];
  targets: number[];
  ops: CubeOp[][];
  flaskCount: number;
  ballCount: number;
}

function applyMove(cols: number[][], from: number, to: number, cap: number): void {
  if (!cols[from]?.length || (cols[to]?.length ?? 0) >= cap) {
    throw new Error('Illegal cube move');
  }
  cols[to].unshift(cols[from][0]);
  cols[from] = cols[from].slice(1);
}

/** Swap the top cubes of two full columns. Ends with every puzzle column full again. */
function swapTops(cols: number[][], a: number, b: number, empty: number, cap: number): void {
  applyMove(cols, a, empty, cap);
  applyMove(cols, b, a, cap);
  applyMove(cols, empty, b, cap);
}

/** Swap the top two cubes inside one column. Ends full. */
function swapTopPair(cols: number[][], column: number, park: number, empty: number, cap: number): void {
  applyMove(cols, park, empty, cap);
  applyMove(cols, column, park, cap);
  applyMove(cols, column, empty, cap);
  applyMove(cols, park, column, cap);
  applyMove(cols, empty, column, cap);
  applyMove(cols, empty, park, cap);
}

/** Move the top cube to the bottom of the same column. Ends full. */
function rotateDown(cols: number[][], column: number, park: number, empty: number, cap: number): void {
  applyMove(cols, park, empty, cap);
  applyMove(cols, column, park, cap);
  for (let i = 0; i < cap - 1; i++) applyMove(cols, column, empty, cap);
  applyMove(cols, park, column, cap);
  for (let i = 0; i < cap - 1; i++) applyMove(cols, empty, column, cap);
  applyMove(cols, empty, park, cap);
}

/**
 * Start from a solved board (every puzzle column full, one empty helper).
 * Change places only with real moves, and only stop once every puzzle column is full again.
 */
function scrambleSolved(solved: number[][], ballCount: number): number[][] {
  const cols = solved.map((col) => [...col]);
  const puzzle = cols.length - 1;
  const empty = puzzle;
  if (puzzle < 2 || ballCount < 2) return cols;
  const steps = 16 + puzzle * ballCount;
  for (let step = 0; step < steps; step++) {
    const a = Math.floor(Math.random() * puzzle);
    let b = Math.floor(Math.random() * (puzzle - 1));
    if (b >= a) b += 1;
    const kind = Math.floor(Math.random() * 3);
    if (kind === 0) swapTops(cols, a, b, empty, ballCount);
    else if (kind === 1) swapTopPair(cols, a, b, empty, ballCount);
    else rotateDown(cols, a, b, empty, ballCount);
  }
  return cols;
}

/** Index 0 is the top cube. Operators apply from the top cube downward. */
export function columnSolved(col: number[], ballCount: number, target: number | undefined, ops: CubeOp[]): boolean {
  if (target == null) return false;
  return col.length === ballCount && columnValue(col, ballCount, ops) === target;
}

export function boardSolved(columns: number[][], targets: number[], flaskCount: number, ballCount: number, ops: CubeOp[][]): boolean {
  for (let i = 0; i < flaskCount; i++) {
    if (!columnSolved(columns[i] ?? [], ballCount, targets[i], ops[i] ?? [])) return false;
  }
  return flaskCount > 0;
}

export function dealLevel(level: number): FlaskDeal {
  const safe = Math.min(LEVEL_COUNT, Math.max(1, level));
  const spec = parseLevel(LEVELS[safe - 1].pattern);
  const tier = tierOf(safe);
  const ballCount = spec[0].length + 1;
  let fallback: FlaskDeal | null = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const solved = spec.map((ops) => fillColumn(ops, tier));
    if (solved.some((col) => col.length !== ballCount)) continue;
    const flat = solved.flat();
    if (flat.every((n) => n === flat[0])) solved[0][0] = solved[0][0] === 1 ? 2 : 1;
    const targets = solved.map((col, index) => columnValue(col, ballCount, spec[index]));
    const board = scrambleSolved([...solved, []], ballCount);
    const full = board.slice(0, spec.length).every((col) => col.length === ballCount) && board[spec.length]?.length === 0;
    if (!full) continue;
    const deal = { columns: board, targets, ops: spec, flaskCount: spec.length, ballCount };
    fallback = deal;
    if (!boardSolved(board, targets, spec.length, ballCount, spec)) return deal;
  }
  return fallback ?? {
    columns: [...spec.map(() => Array.from({ length: ballCount }, () => 1)), []],
    targets: spec.map(() => ballCount),
    ops: spec,
    flaskCount: spec.length,
    ballCount,
  };
}

export function canPlace(column: number[], ballCount: number): boolean {
  return column.length < ballCount;
}

/** Move the top cube (index 0) onto the top of another column. */
export function moveTop(columns: number[][], from: number, to: number, ballCount: number): number[][] | null {
  if (from === to) return null;
  const source = columns[from];
  if (!source?.length) return null;
  if (!canPlace(columns[to] ?? [], ballCount)) return null;
  const next = columns.map((col) => [...col]);
  const ball = next[from][0];
  next[to].unshift(ball);
  next[from] = next[from].slice(1);
  return next;
}
