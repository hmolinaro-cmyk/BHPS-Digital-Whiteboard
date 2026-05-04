export enum Tool {
  Pen = 'pen',
  Eraser = 'eraser',
  Ruler = 'ruler',
  Protractor = 'protractor',
  Select = 'select',
}

export interface Point {
  x: number;
  y: number;
}

export interface WhiteboardLine {
  id: string;
  tool: Tool.Pen | Tool.Eraser;
  points: number[];
  color: string;
  width: number;
  pageIndex: number;
}

export interface ToolState {
  id: string;
  type: Tool.Ruler | Tool.Protractor;
  x: number;
  y: number;
  rotation: number;
  visible: boolean;
  scale: number;
  unit?: 'in' | 'cm';
}

export interface PDFPageInfo {
  url: string;
  width: number;
  height: number;
}

export interface WhiteboardState {
  lines: WhiteboardLine[];
  pdfPages: PDFPageInfo[];
  currentPage: number;
  ruler: ToolState;
  protractor: ToolState;
  brushSize: number;
  eraserSize: number;
  brushColor: string;
}

