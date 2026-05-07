import { useState, useCallback, useEffect } from 'react';
import { WhiteboardState, WhiteboardLine, ToolState, Tool, PDFPageInfo } from '../types/whiteboard';
import { nanoid } from 'nanoid';

export const useWhiteboard = (initialState?: Partial<WhiteboardState>) => {
  const [state, setState] = useState<WhiteboardState>(() => {
    const saved = localStorage.getItem('whiteboard-state');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        
        // Data migration for older saved states that used string arrays for pdfPages
        if (parsed.pdfPages && parsed.pdfPages.length > 0 && typeof parsed.pdfPages[0] === 'string') {
          parsed.pdfPages = parsed.pdfPages.map((url: string) => ({ url, width: 612, height: 792 })); // Assume standard letter if unknown
        }

        const defaultConfig = {
          lines: [],
          pdfPages: [],
          currentPage: 0,
          brushSize: 5,
          eraserSize: 40,
          brushColor: '#000000',
          ruler: {
            id: 'ruler-1',
            type: Tool.Ruler,
            x: 100,
            y: 100,
            rotation: 0,
            visible: false,
            scale: 1,
            unit: 'in',
          },
          protractor: {
            id: 'protractor-1',
            type: Tool.Protractor,
            x: 300,
            y: 300,
            rotation: 0,
            visible: false,
            scale: 1,
          },
        };
        const state = { 
          ...defaultConfig, 
          ...parsed,
          ruler: { ...defaultConfig.ruler, ...parsed.ruler },
          protractor: { ...defaultConfig.protractor, ...parsed.protractor },
        };
        // Ensure tools are always invisible at startup
        state.ruler.visible = false;
        state.protractor.visible = false;
        
        // Ensure scales are valid numbers and have a safe minimum
        if (typeof state.ruler.scale !== 'number' || isNaN(state.ruler.scale) || state.ruler.scale < 0.1) state.ruler.scale = 1;
        if (typeof state.protractor.scale !== 'number' || isNaN(state.protractor.scale) || state.protractor.scale < 0.1) state.protractor.scale = 1;
        
        return state;
      } catch (e) {
        console.error('Failed to parse saved state', e);
      }
    }
    return {
      lines: [],
      pdfPages: [],
      currentPage: 0,
      ruler: {
        id: 'ruler-1',
        type: Tool.Ruler,
        x: 100,
        y: 100,
        rotation: 0,
        visible: false,
        scale: 1,
        unit: 'in',
      },
      protractor: {
        id: 'protractor-1',
        type: Tool.Protractor,
        x: 300,
        y: 300,
        rotation: 0,
        visible: false,
        scale: 1,
      },
      brushSize: 5,
      eraserSize: 40,
      brushColor: '#000000',
      ...initialState,
    };
  });

  useEffect(() => {
    const timeout = setTimeout(() => {
      localStorage.setItem('whiteboard-state', JSON.stringify(state));
    }, 1000); // Save after 1 second of inactivity
    return () => clearTimeout(timeout);
  }, [state]);

  const [history, setHistory] = useState<WhiteboardLine[][]>([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const addLine = useCallback((line: Omit<WhiteboardLine, 'pageIndex'>) => {
    setState((prev) => ({ 
      ...prev, 
      lines: [...prev.lines, { ...line, pageIndex: prev.currentPage }] 
    }));
  }, []);

  const commitToHistory = useCallback(() => {
    setState((prev) => {
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(prev.lines);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
      return prev;
    });
  }, [history, historyIndex]);

  const updateCurrentLine = useCallback((points: number[]) => {
    setState((prev) => {
      const lastIdx = prev.lines.length - 1;
      if (lastIdx < 0) return prev;
      
      const newLines = [...prev.lines];
      newLines[lastIdx] = { ...newLines[lastIdx], points };
      return { ...prev, lines: newLines };
    });
  }, []);

  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const prevIndex = historyIndex - 1;
      setHistoryIndex(prevIndex);
      setState(prev => ({ ...prev, lines: history[prevIndex] }));
    }
  }, [history, historyIndex]);

  const clear = useCallback(() => {
    setState(prev => ({ ...prev, lines: [] }));
    setHistory([[]]);
    setHistoryIndex(0);
  }, []);

  const clearAll = useCallback(() => {
    localStorage.removeItem('whiteboard-state');
    window.location.reload();
  }, []);

  const resetTools = useCallback(() => {
    setState(prev => ({
      ...prev,
      ruler: { ...prev.ruler, x: 100, y: 100, rotation: 0, scale: 1, visible: false },
      protractor: { ...prev.protractor, x: 300, y: 300, rotation: 0, scale: 1, visible: false },
    }));
  }, []);

  const setPDFPages = useCallback((pages: PDFPageInfo[]) => {
    setState(prev => ({ ...prev, pdfPages: pages, currentPage: 0 }));
  }, []);

  const updateToolPos = useCallback((tool: 'ruler' | 'protractor', newState: ToolState) => {
    // Sanitize the incoming state to prevent NaN and extreme scaling
    const sanitizedState = { ...newState };
    if (typeof sanitizedState.scale !== 'number' || isNaN(sanitizedState.scale)) {
      sanitizedState.scale = 1;
    } else {
      sanitizedState.scale = Math.max(0.1, Math.min(10, sanitizedState.scale));
    }
    
    setState(prev => ({ ...prev, [tool]: sanitizedState }));
  }, []);

  const setSize = useCallback((tool: Tool.Pen | Tool.Eraser, size: number) => {
    setState(prev => ({
      ...prev,
      [tool === Tool.Pen ? 'brushSize' : 'eraserSize']: Math.max(1, size)
    }));
  }, []);

  const setColor = useCallback((color: string) => {
    setState(prev => ({ ...prev, brushColor: color }));
  }, []);

  const setToolScale = useCallback((scale: number) => {
    if (typeof scale !== 'number' || isNaN(scale)) return;
    const clampedScale = Math.max(0.5, Math.min(3.0, scale));
    setState(prev => ({
      ...prev,
      ruler: { ...prev.ruler, scale: clampedScale },
      protractor: { ...prev.protractor, scale: clampedScale }
    }));
  }, []);

  return {
    state,
    addLine,
    updateCurrentLine,
    undo,
    clear,
    clearAll,
    resetTools,
    commitToHistory,
    setPDFPages,
    updateToolPos,
    setSize,
    setColor,
    setToolScale,
    setState
  };
};

