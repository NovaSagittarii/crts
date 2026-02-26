import { io } from 'socket.io-client';

interface StatePayload {
  width: number;
  height: number;
  generation: number;
  grid: string;
}

interface Cell {
  x: number;
  y: number;
}

const canvas = document.getElementById('grid') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const generationEl = document.getElementById('generation')!;
const statusEl = document.getElementById('status')!;

const socket = io();

let gridWidth = 0;
let gridHeight = 0;
let gridBytes: Uint8Array | null = null;
let cellSize = 6;
let isDrawing = false;
let drawValue = 1;
let lastCell: Cell | null = null;

function decodeBase64ToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function getBit(bytes: Uint8Array, index: number): boolean {
  const byteIndex = index >> 3;
  const bitIndex = index & 7;
  const mask = 1 << (7 - bitIndex);
  return (bytes[byteIndex] & mask) !== 0;
}

function getCell(x: number, y: number): number {
  if (!gridBytes) return 0;
  const idx = y * gridWidth + x;
  return getBit(gridBytes, idx) ? 1 : 0;
}

function chooseCellSize(width: number): number {
  const maxWidth = Math.max(240, window.innerWidth - 32);
  const proposed = Math.floor(maxWidth / width);
  return Math.max(3, Math.min(8, proposed));
}

function resizeCanvas(): void {
  if (!gridWidth || !gridHeight) return;

  cellSize = chooseCellSize(gridWidth);
  const ratio = window.devicePixelRatio || 1;
  const cssWidth = gridWidth * cellSize;
  const cssHeight = gridHeight * cellSize;

  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.width = Math.floor(cssWidth * ratio);
  canvas.height = Math.floor(cssHeight * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function render(): void {
  if (!gridBytes) return;

  ctx.fillStyle = '#05070d';
  ctx.fillRect(0, 0, gridWidth * cellSize, gridHeight * cellSize);

  ctx.fillStyle = '#46d5b6';
  for (let y = 0; y < gridHeight; y += 1) {
    for (let x = 0; x < gridWidth; x += 1) {
      const idx = y * gridWidth + x;
      if (!getBit(gridBytes, idx)) continue;
      ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
    }
  }
}

function pointerToCell(event: PointerEvent): Cell | null {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((event.clientX - rect.left) / cellSize);
  const y = Math.floor((event.clientY - rect.top) / cellSize);
  if (x < 0 || y < 0 || x >= gridWidth || y >= gridHeight) return null;
  return { x, y };
}

function sendUpdate(x: number, y: number, alive: number): void {
  socket.emit('cell:update', { x, y, alive });
}

function handleDraw(event: PointerEvent): void {
  const cell = pointerToCell(event);
  if (!cell) return;

  if (lastCell && lastCell.x === cell.x && lastCell.y === cell.y) return;

  lastCell = cell;
  sendUpdate(cell.x, cell.y, drawValue);
}

canvas.addEventListener('pointerdown', (event) => {
  if (!gridBytes) return;

  canvas.setPointerCapture(event.pointerId);
  isDrawing = true;
  const cell = pointerToCell(event);
  if (!cell) return;

  drawValue = getCell(cell.x, cell.y) ? 0 : 1;
  lastCell = null;
  handleDraw(event);
});

canvas.addEventListener('pointermove', (event) => {
  if (!isDrawing) return;
  handleDraw(event);
});

function stopDrawing(event: PointerEvent): void {
  if (!isDrawing) return;
  isDrawing = false;
  lastCell = null;
  if (event.pointerId) {
    canvas.releasePointerCapture(event.pointerId);
  }
}

canvas.addEventListener('pointerup', stopDrawing);
canvas.addEventListener('pointerleave', stopDrawing);
canvas.addEventListener('pointercancel', stopDrawing);

window.addEventListener('resize', () => {
  const previousCellSize = cellSize;
  resizeCanvas();
  if (cellSize !== previousCellSize) render();
});

socket.on('connect', () => {
  statusEl.textContent = 'Connected';
});

socket.on('disconnect', () => {
  statusEl.textContent = 'Disconnected';
});

socket.on('state', (payload: StatePayload) => {
  gridWidth = payload.width;
  gridHeight = payload.height;
  gridBytes = decodeBase64ToBytes(payload.grid);
  generationEl.textContent = payload.generation.toString();

  resizeCanvas();
  render();
});
