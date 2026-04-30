import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Stage, Layer, Line, Circle } from 'react-konva';
import { nanoid } from 'nanoid';
import { Tool, Point } from '../../types/whiteboard';
import { useWhiteboard } from '../../hooks/useWhiteboard';
import { Ruler } from './Ruler';
import { Protractor as BarProtractor } from './Protractor';
import { PDFPage } from './PDFPage';
import { getNearestPointOnLine, getNearestPointOnArc } from '../../lib/geometry';
import { Button } from '../ui/button';
import { 
  Pencil, 
  Eraser, 
  Undo, 
  Trash2, 
  Ruler as RulerIcon, 
  Circle as ProtractorIcon,
  Upload,
  Download,
  Hand,
  AlertCircle,
  RotateCw
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import { Slider } from '../ui/slider';
import { ScrollArea } from '../ui/scroll-area';
import { renderPDFToImages } from '../../lib/pdf';
import { 
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../ui/popover";
import { 
  Tooltip, 
  TooltipContent, 
  TooltipProvider, 
  TooltipTrigger 
} from '../ui/tooltip';

export const Whiteboard: React.FC = () => {
  const { 
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
    setState 
  } = useWhiteboard();

  const [currentTool, setCurrentTool] = useState<Tool>(Tool.Pen);
  const [isDrawing, setIsDrawing] = useState(false);
  const [docScale, setDocScale] = useState(0.9);
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight - 80 });
  const [pdfHeight, setPdfHeight] = useState(0);

  const stageRef = useRef<any>(null);
  const eraserRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Maintain a stable ref for state to avoid recreating event handlers
  const stateRef = useRef(state);
  const currentToolRef = useRef(currentTool);
  const isDrawingRef = useRef(isDrawing);
  const docScaleRef = useRef(docScale);
  const currentLinePointsRef = useRef<number[]>([]);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { currentToolRef.current = currentTool; }, [currentTool]);
  useEffect(() => { isDrawingRef.current = isDrawing; }, [isDrawing]);
  useEffect(() => { docScaleRef.current = docScale; }, [docScale]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [state.currentPage]);

  // PDF Height management

  useEffect(() => {
    const handleResize = () => {
      setDimensions({ width: window.innerWidth, height: window.innerHeight - 80 });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const stageWidth = (dimensions.width - 480) * docScale;
  const stageHeight = Math.max(dimensions.height - 180, (pdfHeight + 40) * docScale);

  const handlePointerDown = useCallback((e: any) => {
    // Prevent drawing when clicking on tools or buttons or if not primary pointer
    if (currentToolRef.current === Tool.Select) return;
    
    // Prevent default browser behavior explicitly
    if (e.evt && e.evt.cancelable !== false) {
      e.evt.preventDefault();
    }

    const stage = stageRef.current;
    if (!stage) return;
    
    const pos = stage.getPointerPosition();
    if (!pos) return;

    // Transform stage coordinates to layer coordinates by dividing by docScale
    const transformedPos = {
      x: pos.x / docScaleRef.current,
      y: pos.y / docScaleRef.current
    };

    setIsDrawing(true);
    isDrawingRef.current = true;
    
    // Check for snapping
    let startPoint = transformedPos;
    const snapThreshold = 1.0 / docScaleRef.current;
    let bestSnap: Point | null = null;
    let minSnapDist = Infinity;

    if (currentToolRef.current !== Tool.Eraser) {
      if (stateRef.current.ruler.visible) {
        const rad = (stateRef.current.ruler.rotation * Math.PI) / 180;
        const inchStep = 98.425 * stateRef.current.ruler.scale;
        const rWidth = 10 * inchStep;
        const rStart = { x: stateRef.current.ruler.x, y: stateRef.current.ruler.y };
        const rEnd = { 
          x: stateRef.current.ruler.x + Math.cos(rad) * rWidth, 
          y: stateRef.current.ruler.y + Math.sin(rad) * rWidth 
        };
        
        const snapped = getNearestPointOnLine(transformedPos, rStart, rEnd, snapThreshold);
        if (snapped) {
          const dist = Math.sqrt((transformedPos.x - snapped.x) ** 2 + (transformedPos.y - snapped.y) ** 2);
          if (dist < minSnapDist) {
            minSnapDist = dist;
            bestSnap = snapped;
          }
        }
      }

      if (stateRef.current.protractor.visible) {
        const radius = 400 * stateRef.current.protractor.scale;
        const center = { x: stateRef.current.protractor.x, y: stateRef.current.protractor.y };
        const snapped = getNearestPointOnArc(transformedPos, center, radius, snapThreshold, stateRef.current.protractor.rotation);
        if (snapped) {
          const dist = Math.sqrt((transformedPos.x - snapped.x) ** 2 + (transformedPos.y - snapped.y) ** 2);
          if (dist < minSnapDist) {
            minSnapDist = dist;
            bestSnap = snapped;
          }
        }
      }
    }

    if (bestSnap) startPoint = bestSnap;

    const initialPoints = [startPoint.x, startPoint.y, startPoint.x, startPoint.y];
    currentLinePointsRef.current = initialPoints;

    addLine({
      id: nanoid(),
      tool: currentToolRef.current === Tool.Eraser ? Tool.Eraser : Tool.Pen,
      points: initialPoints,
      color: currentToolRef.current === Tool.Eraser ? '#ffffff' : stateRef.current.brushColor,
      width: (currentToolRef.current === Tool.Eraser ? stateRef.current.eraserSize : stateRef.current.brushSize) / docScaleRef.current,
    });
  }, [addLine]);

  const handlePointerMove = useCallback((e: any) => {
    const stage = stageRef.current;
    if (!stage) return;
    const pos = stage.getPointerPosition();
    
    if (!pos) {
      if (eraserRef.current?.visible()) {
        eraserRef.current.visible(false);
        eraserRef.current.getLayer()?.batchDraw();
      }
      return;
    }

    const transformedPos = {
      x: pos.x / docScaleRef.current,
      y: pos.y / docScaleRef.current
    };
    
    // Imperatively update eraser cursor to avoid React re-render cycles
    if (eraserRef.current) {
      if (currentToolRef.current === Tool.Eraser) {
        eraserRef.current.position(transformedPos);
        eraserRef.current.radius((stateRef.current.eraserSize / 2) / docScaleRef.current);
        eraserRef.current.visible(true);
        eraserRef.current.moveToTop(); // Ensure it's above other elements in the same layer
        eraserRef.current.getLayer()?.batchDraw();
      } else if (eraserRef.current.visible()) {
        eraserRef.current.visible(false);
        eraserRef.current.getLayer()?.batchDraw();
      }
    }

    if (!isDrawingRef.current) return;

    // Use currentLinePointsRef to avoid stale state issues
    const points = currentLinePointsRef.current;
    if (points.length < 2) return;
    
    const lastX = points[points.length - 2];
    const lastY = points[points.length - 1];
    
    const moveDist = Math.sqrt((transformedPos.x - lastX) ** 2 + (transformedPos.y - lastY) ** 2);
    if (moveDist < 2 / docScaleRef.current) return;

    let currentPoint = transformedPos;
    const snapThreshold = 1.0 / docScaleRef.current;
    let bestSnap: Point | null = null;
    let minSnapDist = Infinity;

    if (currentToolRef.current !== Tool.Eraser) {
      if (stateRef.current.ruler.visible) {
        const rad = (stateRef.current.ruler.rotation * Math.PI) / 180;
        const inchStep = 98.425 * stateRef.current.ruler.scale;
        const rWidth = 10 * inchStep;
        const rStart = { x: stateRef.current.ruler.x, y: stateRef.current.ruler.y };
        const rEnd = { 
          x: stateRef.current.ruler.x + Math.cos(rad) * rWidth, 
          y: stateRef.current.ruler.y + Math.sin(rad) * rWidth 
        };
        const snapped = getNearestPointOnLine(transformedPos, rStart, rEnd, snapThreshold);
        if (snapped) {
          const d = Math.sqrt((transformedPos.x - snapped.x) ** 2 + (transformedPos.y - snapped.y) ** 2);
          if (d < minSnapDist) {
            minSnapDist = d;
            bestSnap = snapped;
          }
        }
      }

      if (stateRef.current.protractor.visible) {
        const radius = 400 * stateRef.current.protractor.scale;
        const center = { x: stateRef.current.protractor.x, y: stateRef.current.protractor.y };
        const snapped = getNearestPointOnArc(transformedPos, center, radius, snapThreshold, stateRef.current.protractor.rotation);
        if (snapped) {
          const d = Math.sqrt((transformedPos.x - snapped.x) ** 2 + (transformedPos.y - snapped.y) ** 2);
          if (d < minSnapDist) {
            minSnapDist = d;
            bestSnap = snapped;
          }
        }
      }
    }

    if (bestSnap) currentPoint = bestSnap;

    const newPoints = points.concat([currentPoint.x, currentPoint.y]);
    currentLinePointsRef.current = newPoints;
    updateCurrentLine(newPoints);
  }, [updateCurrentLine]);

  const handlePointerUp = useCallback(() => {
    if (isDrawingRef.current) {
      commitToHistory();
      setIsDrawing(false);
      isDrawingRef.current = false;
    }
  }, [commitToHistory]);

  const [isExporting, setIsExporting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const downloadAsPDF = useCallback(async () => {
    if (state.pdfPages.length === 0) return;

    setIsExporting(true);
    // Give UI a chance to render overlay
    await new Promise(resolve => setTimeout(resolve, 100));

    try {
      const pdf = new jsPDF({
        unit: 'px',
        compress: true
      });

      const pdfCanvas = document.createElement('canvas');
      const pdfCtx = pdfCanvas.getContext('2d');
      const lineCanvas = document.createElement('canvas');
      const lineCtx = lineCanvas.getContext('2d');
      
      if (!pdfCtx || !lineCtx) throw new Error('Could not create canvas contexts');

      // Reference width used during drawing (PDFPage component's width prop)
      const screenWidth = dimensions.width - 500;

      for (let i = 0; i < state.pdfPages.length; i++) {
        // Update progress UI
        setState(prev => ({ ...prev, currentPage: i }));
        
        const pageImage = state.pdfPages[i];
        
        // Wait for image loading
        const img = new Image();
        img.src = pageImage;
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
        });

        const width = img.width;
        const height = img.height;
        
        // Calculate scale factor between the screen representation and the intrinsic PDF image
        const scaleFactor = width / screenWidth;

        pdfCanvas.width = width;
        pdfCanvas.height = height;
        lineCanvas.width = width;
        lineCanvas.height = height;

        // Draw PDF page
        pdfCtx.clearRect(0, 0, width, height);
        pdfCtx.drawImage(img, 0, 0);

        // Draw Lines on a separate canvas to handle transparency/eraser correctly
        lineCtx.clearRect(0, 0, width, height);
        const pageLines = state.lines.filter(l => l.pageIndex === i);
        
        pageLines.forEach(line => {
          if (line.points.length < 2) return;
          
          lineCtx.beginPath();
          lineCtx.lineCap = 'round';
          lineCtx.lineJoin = 'round';
          lineCtx.strokeStyle = line.color;
          lineCtx.lineWidth = line.width * scaleFactor;
          lineCtx.globalCompositeOperation = line.tool === Tool.Eraser ? 'destination-out' : 'source-over';

          lineCtx.moveTo(line.points[0] * scaleFactor, line.points[1] * scaleFactor);
          for (let j = 2; j < line.points.length; j += 2) {
            lineCtx.lineTo(line.points[j] * scaleFactor, line.points[j+1] * scaleFactor);
          }
          lineCtx.stroke();
        });

        // Composite lines onto PDF
        pdfCtx.drawImage(lineCanvas, 0, 0);

        // Capture final page
        const dataUrl = pdfCanvas.toDataURL('image/jpeg', 0.9);
        
        if (i > 0) {
            pdf.addPage([width, height], width > height ? 'l' : 'p');
        } else {
            pdf.deletePage(1);
            pdf.addPage([width, height], width > height ? 'l' : 'p');
        }
        
        pdf.addImage(dataUrl, 'JPEG', 0, 0, width, height, undefined, 'FAST');
        
        // Small yield to prevent main thread blocking
        if (i % 3 === 0) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }

      pdf.save(`BHPS-Whiteboard-${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (err) {
      console.error('Failed to generate multi-page PDF', err);
    } finally {
      setIsExporting(false);
    }
  }, [state.pdfPages, state.lines, setState, dimensions.width]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setIsUploading(true);
      try {
        const pages = await renderPDFToImages(file);
        setPDFPages(pages);
        
        // Maintain 1:1 local scale for the tools (accuracy)
        const newScale = 1.0;
        
        updateToolPos('ruler', { ...state.ruler, scale: newScale, visible: false });
        updateToolPos('protractor', { ...state.protractor, scale: newScale, visible: false });
      } catch (err) {
        console.error('PDF Upload failed', err);
      } finally {
        setIsUploading(false);
      }
    }
  };

  const toggleTool = (tool: 'ruler' | 'protractor') => {
    const toolState = state[tool];
    if (!toolState.visible && containerRef.current) {
      const container = containerRef.current;
      // Get center of viewport relative to container's scroll content
      const centerX = container.scrollLeft + container.clientWidth / 2;
      const centerY = container.scrollTop + container.clientHeight / 2;
      
      // Stage is the content within the container (plus p-4 padding)
      const transformedX = (centerX - 16) / docScale;
      const transformedY = (centerY - 16) / docScale;
      
      updateToolPos(tool, { ...toolState, x: transformedX, y: transformedY, visible: true });
    } else {
      updateToolPos(tool, { ...toolState, visible: !toolState.visible });
    }
  };

  const currentSize = currentTool === Tool.Eraser ? state.eraserSize : state.brushSize;

  const memoLines = React.useMemo(() => state.lines
    .filter(line => line.pageIndex === state.currentPage)
    .map((line) => (
    <Line
      key={line.id}
      points={line.points}
      stroke={line.color}
      strokeWidth={line.width}
      tension={line.tool === Tool.Eraser ? 0 : 0.5}
      lineCap="round"
      lineJoin="round"
      listening={false}
      perfectDrawEnabled={false}
      globalCompositeOperation={
        line.tool === Tool.Eraser ? 'destination-out' : 'source-over'
      }
    />
  )), [state.lines, state.currentPage]);

  return (
    <div className="h-screen bg-bento-bg p-3 font-sans overflow-hidden">
      <div className="grid grid-cols-[200px_1fr] grid-rows-[70px_1fr_90px] gap-3 h-full max-w-[98vw] mx-auto">
        
        <div className="bento-card col-span-2 flex-row items-center justify-between px-6 bg-bento-primary text-white border-bento-border">
          <div className="flex flex-col">
            <span className="font-black text-xl tracking-tighter leading-none">BHPS DIGITAL WHITEBOARD</span>
            <span className="text-[10px] font-bold opacity-80 uppercase tracking-widest mt-1 italic">NJ K-12 DISTRICT | AP10 OPS</span>
          </div>
          <div className="flex items-center gap-4">
            <Button 
               variant="outline" 
               className="bg-white/10 text-white hover:bg-white/20 border-white/30 text-[10px] h-8 px-3 font-black uppercase tracking-widest"
               onClick={resetTools}
            >
              Reset Tools
            </Button>
            <Button 
              className="bg-white text-bento-primary hover:bg-slate-100 font-black px-6 border-bento-border border-2 shadow-[2px_2px_0px_0px_#0f172a]"
              onClick={downloadAsPDF}
            >
              EXPORT PDF
            </Button>
          </div>
        </div>

        <div className="bento-card row-span-2 bg-bento-secondary group">
          <div className="p-3 border-b-2 border-bento-border bg-white flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Pages ({state.pdfPages.length})</span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger 
                  className="h-6 w-6 inline-flex items-center justify-center rounded-md hover:bg-slate-100 transition-colors cursor-pointer" 
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="w-3 h-3 text-slate-400" />
                </TooltipTrigger>
                <TooltipContent>Upload PDF</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <ScrollArea className="flex-1 p-2 min-h-0">
            <div className="space-y-3">
              {state.pdfPages.length === 0 ? (
                <div className="p-4 text-center border-2 border-dashed border-slate-300 rounded-xl mt-4">
                   <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter italic">No document loaded</p>
                </div>
              ) : (
                state.pdfPages.map((page, idx) => (
                  <div 
                    key={idx}
                    onClick={() => setState(prev => ({ ...prev, currentPage: idx }))}
                    className={`
                      aspect-[3/4] rounded-xl border-2 cursor-pointer transition-all flex flex-col items-center justify-center p-2 text-center
                      ${state.currentPage === idx 
                        ? 'border-bento-primary bg-blue-50 shadow-[2px_2px_0px_0px_#3b82f6]' 
                        : 'border-slate-200 bg-white hover:border-slate-400'}
                    `}
                  >
                    <div className="w-full h-full bg-slate-100 rounded-lg overflow-hidden border border-slate-200 mb-2">
                      <img src={page} alt={`Page ${idx + 1}`} className="w-full h-full object-cover" />
                    </div>
                    <span className={`text-[10px] font-black uppercase ${state.currentPage === idx ? 'text-bento-primary' : 'text-slate-500'}`}>
                      Page {idx + 1}
                    </span>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="bento-card bg-slate-200 relative overflow-hidden">
          <div 
            ref={containerRef}
            className={`absolute inset-0 p-4 bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:20px_20px] scroll-smooth ${isDrawing ? 'overflow-hidden' : 'overflow-auto'}`}
            style={{ touchAction: currentTool === Tool.Select ? 'auto' : 'none' }}
          >
            <div 
              className="shrink-0 shadow-2xl border-bento-border border bg-white mb-20 mx-auto" 
              style={{ 
                width: stageWidth, 
                height: stageHeight,
                minHeight: dimensions.height - 200, // Ensure it's always at least visible
                touchAction: currentTool === Tool.Select ? 'auto' : 'none'
              }}
            >
              <Stage
                width={stageWidth}
                height={stageHeight}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={() => {
                   handlePointerUp();
                   if (eraserRef.current?.visible()) {
                     eraserRef.current.visible(false);
                     eraserRef.current.getLayer()?.batchDraw();
                   }
                }}
                ref={stageRef}
                className="bg-white"
                style={{ touchAction: currentTool === Tool.Select ? 'auto' : 'none' }}
              >
                <Layer scaleX={docScale} scaleY={docScale}>
                  {state.pdfPages[state.currentPage] && (
                    <PDFPage 
                      url={state.pdfPages[state.currentPage]} 
                      width={(dimensions.width - 500)} 
                      onHeightChange={setPdfHeight}
                    />
                  )}
                </Layer>

                <Layer scaleX={docScale} scaleY={docScale}>
                  {memoLines}
                  <Circle
                    ref={eraserRef}
                    stroke="#64748b"
                    strokeWidth={1.5 / docScale}
                    dash={[4, 4]}
                    opacity={0.5}
                    listening={false}
                    visible={false}
                  />
                </Layer>

                <Layer scaleX={docScale} scaleY={docScale}>
                  <Ruler 
                    state={state.ruler} 
                    onChange={(s) => updateToolPos('ruler', s)} 
                    documentScale={docScale}
                    draggable={currentTool === Tool.Select}
                    listening={currentTool === Tool.Select}
                  />
                  <BarProtractor 
                    state={state.protractor} 
                    onChange={(s) => updateToolPos('protractor', s)} 
                    documentScale={docScale}
                    draggable={currentTool === Tool.Select}
                    listening={currentTool === Tool.Select}
                  />
                </Layer>
              </Stage>
            </div>
          </div>

          <div className="absolute bottom-4 right-4 flex items-center gap-2 bg-white/90 backdrop-blur border-2 border-bento-border p-1.5 rounded-xl shadow-lg z-10">
            <button 
              onClick={() => setDocScale(prev => Math.max(0.2, prev - 0.1))}
              className="w-8 h-8 flex items-center justify-center border-2 border-slate-200 rounded-lg hover:bg-slate-100 font-bold transition-colors"
            >
              -
            </button>
            <span className="text-[10px] font-black w-10 text-center font-mono">
              {Math.round(docScale * 100)}%
            </span>
            <button 
              onClick={() => setDocScale(prev => Math.min(3, prev + 0.1))}
              className="w-8 h-8 flex items-center justify-center border-2 border-slate-200 rounded-lg hover:bg-slate-100 font-bold transition-colors"
            >
              +
            </button>
          </div>
        </div>

        <div className="bento-card col-span-1 flex-row items-center justify-start gap-8 px-6 bg-white overflow-visible">
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept=".pdf" 
            onChange={handleFileUpload}
          />
          
          <div className="flex items-center gap-2 p-1.5 bg-slate-100 rounded-2xl border-2 border-slate-200 shrink-0">
            <button 
              className={`bento-tool-btn ${currentTool === Tool.Pen ? 'bento-tool-btn-active' : ''}`}
              onClick={() => {
                setCurrentTool(Tool.Pen);
                currentToolRef.current = Tool.Pen;
              }}
            >
              <Pencil className="w-5 h-5" />
            </button>
            <button 
              className={`bento-tool-btn ${currentTool === Tool.Eraser ? 'bento-tool-btn-active' : ''}`}
              onClick={() => {
                setCurrentTool(Tool.Eraser);
                currentToolRef.current = Tool.Eraser;
              }}
            >
              <Eraser className="w-5 h-5" />
            </button>
            <button 
              className={`bento-tool-btn ${currentTool === Tool.Select ? 'bento-tool-btn-active' : ''}`}
              onClick={() => {
                setCurrentTool(Tool.Select);
                currentToolRef.current = Tool.Select;
              }}
              title="Scroll / Select"
            >
              <Hand className="w-5 h-5" />
            </button>
          </div>

          <div className="flex items-center gap-6 flex-1 min-w-[250px] max-w-[350px]">
            <div className="flex flex-col min-w-[60px]">
               <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest leading-none mb-1">
                 {currentTool === Tool.Eraser ? 'Eraser' : 'Brush'}
               </span>
               <div className="flex items-baseline gap-1">
                 <span className="text-sm font-black text-slate-900 leading-none">{currentSize}</span>
                 <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">px</span>
               </div>
            </div>

            <div className="flex items-center gap-4 flex-1 relative h-14 min-w-[200px]">
              <div className="flex-1 flex items-center h-full relative px-2">
                {/* Tapered line background */}
                <div className="absolute inset-x-2 top-1/2 -translate-y-1/2 h-5 pointer-events-none opacity-20">
                   <svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 20" className="fill-slate-900">
                      <path d="M 0 10 L 100 2 L 100 18 L 0 10 Z" />
                   </svg>
                </div>
                
                <Slider 
                  key={currentTool === Tool.Eraser ? 'eraser' : 'brush'}
                  value={[currentSize]} 
                  onValueChange={(val: any) => {
                    const nextValue = Array.isArray(val) ? val[0] : val;
                    if (typeof nextValue === 'number') {
                      setSize(currentTool === Tool.Eraser ? Tool.Eraser : Tool.Pen, nextValue);
                    }
                  }} 
                  max={currentTool === Tool.Eraser ? 200 : 100} 
                  min={1} 
                  step={1}
                  className="cursor-pointer relative z-10 w-full"
                />
              </div>

              {/* Visual weight indicator */}
              <div className="w-14 h-14 flex items-center justify-center bg-white rounded-2xl border-[3px] border-bento-border shadow-[4px_4px_0px_0px_#0f172a] shrink-0">
                <div 
                  className="rounded-full transition-all duration-75"
                  style={{ 
                    width: `${Math.max(2, Math.min(40, currentSize / (currentTool === Tool.Eraser ? 4 : 2)))}px`,
                    height: `${Math.max(2, Math.min(40, currentSize / (currentTool === Tool.Eraser ? 4 : 2)))}px`,
                    backgroundColor: currentTool === Tool.Eraser ? '#64748b' : state.brushColor,
                    boxShadow: currentTool === Tool.Eraser ? '0 0 0 1px #94a3b8' : 'none'
                  }}
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-full border-2 border-slate-200 shrink-0">
            {[
              { name: 'Black', color: '#000000' },
              { name: 'Red', color: '#ef4444' },
              { name: 'Blue', color: '#3b82f6' },
              { name: 'Green', color: '#22c55e' },
              { name: 'Purple', color: '#a855f7' },
              { name: 'Amber', color: '#f59e0b' },
            ].map((c) => (
              <button
                key={c.color}
                onClick={() => {
                  setColor(c.color);
                  if (currentTool === Tool.Eraser) {
                    setCurrentTool(Tool.Pen);
                    currentToolRef.current = Tool.Pen;
                  }
                }}
                className={`w-7 h-7 rounded-full border-2 transition-all hover:scale-110 active:scale-95 ${
                  state.brushColor === c.color && currentTool !== Tool.Eraser ? 'border-white ring-2 ring-bento-primary shadow-lg scale-110' : 'border-transparent opacity-80 hover:opacity-100'
                }`}
                style={{ backgroundColor: c.color }}
                title={c.name}
              />
            ))}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="flex flex-col items-center gap-1">
              <div className="flex items-center gap-1">
                <button 
                  className={`bento-tool-btn ${state.ruler.visible ? 'bento-tool-btn-active bg-amber-400' : ''}`}
                  onClick={() => toggleTool('ruler')}
                >
                  <RulerIcon className="w-5 h-5" />
                </button>
                <button 
                  className="bento-tool-btn hover:bg-amber-100 border-amber-200"
                  onClick={() => updateToolPos('ruler', { ...state.ruler, rotation: 0 })}
                  title="Reset Ruler to 0°"
                >
                  <span className="text-[10px] font-black">0°</span>
                </button>
                <button 
                  className="bento-tool-btn hover:bg-amber-100 border-amber-200"
                  onClick={() => updateToolPos('ruler', { ...state.ruler, rotation: (state.ruler.rotation + 90) % 360 })}
                  title="Rotate Ruler 90°"
                >
                  <RotateCw className="w-4 h-4" />
                </button>
              </div>
              <span className="text-[9px] font-black font-mono text-amber-600 uppercase tracking-tighter">
                Ruler: {Math.round(state.ruler.rotation)}°
              </span>
            </div>

            <div className="w-[1px] h-6 bg-slate-200" />

            <div className="flex flex-col items-center gap-1 group">
               <Popover>
                  <PopoverTrigger className="bento-tool-btn hover:bg-slate-200 border-slate-200" title="Adjust Tool Scale">
                    <span className="text-[10px] font-black">1x</span>
                  </PopoverTrigger>
                  <PopoverContent className="w-48 p-4">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase">Tool Size</span>
                        <span className="text-[10px] font-mono bg-slate-100 px-1.5 py-0.5 rounded">{Math.round(state.ruler.scale * 100)}%</span>
                      </div>
                      <Slider
                        value={[state.ruler.scale]}
                        min={0.5}
                        max={3.0}
                        step={0.1}
                        onValueChange={(val) => {
                          const scale = val[0];
                          updateToolPos('ruler', { ...state.ruler, scale });
                          updateToolPos('protractor', { ...state.protractor, scale });
                        }}
                      />
                    </div>
                  </PopoverContent>
               </Popover>
               <span className="text-[9px] font-black font-mono text-slate-400 uppercase tracking-tighter">
                Size
              </span>
            </div>

            <div className="w-[1px] h-6 bg-slate-200" />

            <div className="flex flex-col items-center gap-1">
              <div className="flex items-center gap-1">
                <button 
                  className={`bento-tool-btn ${state.protractor.visible ? 'bento-tool-btn-active bg-sky-400' : ''}`}
                  onClick={() => toggleTool('protractor')}
                >
                  <ProtractorIcon className="w-5 h-5" />
                </button>
                <button 
                  className="bento-tool-btn hover:bg-sky-100 border-sky-200"
                  onClick={() => updateToolPos('protractor', { ...state.protractor, rotation: 0 })}
                  title="Reset Protractor to 0°"
                >
                  <span className="text-[10px] font-black">0°</span>
                </button>
                <button 
                  className="bento-tool-btn hover:bg-sky-100 border-sky-200"
                  onClick={() => updateToolPos('protractor', { ...state.protractor, rotation: (state.protractor.rotation + 90) % 360 })}
                  title="Rotate Protractor 90°"
                >
                  <RotateCw className="w-4 h-4" />
                </button>
              </div>
              <span className="text-[9px] font-black font-mono text-sky-600 uppercase tracking-tighter">
                Prot: {Math.round(state.protractor.rotation)}°
              </span>
            </div>
          </div>

          <div className="w-[2px] h-10 bg-slate-200 mx-1" />

          <div className="flex items-center gap-1.5">
            <button className="bento-tool-btn hover:text-bento-primary" onClick={undo} title="Undo">
              <Undo className="w-5 h-5" />
            </button>
            
            <Popover>
              <PopoverTrigger className="bento-tool-btn hover:text-red-500" title="Clear Canvas">
                <Trash2 className="w-5 h-5" />
              </PopoverTrigger>
              <PopoverContent className="w-64 p-4 border-2 border-bento-border shadow-2xl">
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-500 mt-1 shrink-0" />
                    <div>
                      <h4 className="text-xs font-black uppercase tracking-widest text-slate-900">Dangerous Action</h4>
                      <p className="text-[10px] font-bold text-slate-500 uppercase mt-1 leading-tight">
                        Choose what to wipe from the current session.
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-2 pt-2">
                    <Button 
                      variant="outline" 
                      onClick={() => {
                        clear();
                      }}
                      className="h-9 justify-start text-[10px] font-black uppercase tracking-widest border-2 border-slate-200 hover:border-red-200 hover:bg-red-50"
                    >
                      Clear Annotations
                    </Button>
                    <Button 
                      variant="destructive"
                      onClick={() => {
                        clearAll();
                      }}
                      className="h-9 justify-start text-[10px] font-black uppercase tracking-widest shadow-[2px_2px_0px_0px_#7f1d1d]"
                    >
                      Wipe Everything
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

      </div>
      
      {(isExporting || isUploading) && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] flex flex-col items-center justify-center">
            <div className="bg-white p-8 rounded-3xl border-4 border-bento-border shadow-[8px_8px_0px_0px_#0f172a] text-center max-w-sm">
                <div className="w-16 h-16 border-8 border-slate-100 border-t-bento-primary rounded-full animate-spin mx-auto mb-6" />
                <h2 className="text-2xl font-black uppercase tracking-tighter text-slate-900 leading-tight">
                  {isExporting ? "Generating PDF" : "Processing PDF"}
                </h2>
                <p className="text-xs font-bold text-slate-500 uppercase mt-2 tracking-widest">
                  {isExporting ? "Processing all pages and annotations..." : "Converting document for digital whiteboard..."}
                </p>
                {isExporting && (
                  <>
                    <div className="mt-6 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div 
                            className="h-full bg-bento-primary transition-all duration-500" 
                            style={{ width: `${(state.currentPage / state.pdfPages.length) * 100}%` }}
                        />
                    </div>
                    <p className="text-[10px] font-black text-bento-primary mt-2">PAGE {state.currentPage + 1} OF {state.pdfPages.length}</p>
                  </>
                )}
            </div>
        </div>
      )}
    </div>
  );
};
