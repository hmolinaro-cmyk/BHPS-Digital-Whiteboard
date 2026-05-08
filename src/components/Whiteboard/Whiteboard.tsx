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
    setToolScale,
    setState 
  } = useWhiteboard();

  const [currentTool, setCurrentTool] = useState<Tool>(Tool.Select);
  const [isDrawing, setIsDrawing] = useState(false);
  const [docScale, setDocScale] = useState(0.9);
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight - 80 });
  const [pdfHeight, setPdfHeight] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [containerDimensions, setContainerDimensions] = useState({ width: 0, height: 0 });

  const stageRef = useRef<any>(null);
  const eraserRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Use container dimensions if available for better resolution awareness
  const activeWidth = containerDimensions.width || (dimensions.width - 480);
  const activeHeight = containerDimensions.height || (dimensions.height - 180);

  // Use the intrinsic PDF width as the base coordinate system to prevent drift on resize
  const currentPageInfo = state.pdfPages[state.currentPage];
  const pdfInternalWidth = currentPageInfo?.width || 800;
  
  // Fit scale: how much to scale the internal units to fit the current viewport width
  const fitScale = Math.max(0.2, (activeWidth - 48) / pdfInternalWidth);
  
  // Total display scale combines the auto-fit with the user's manual zoom
  const totalDisplayScale = docScale * fitScale;

  // Since we are now using PDF points (1/72") as the internal coordinate system, 
  // tools should be sized in points directly (no resolution-based scaling needed).
  const resScale = 1.0;

  // Maintain stable refs for state to avoid recreating event handlers
  const stateRef = useRef(state);
  const currentToolRef = useRef(currentTool);
  const isDrawingRef = useRef(isDrawing);
  const totalDisplayScaleRef = useRef(totalDisplayScale);
  const resScaleRef = useRef(resScale);
  const currentLinePointsRef = useRef<number[]>([]);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { currentToolRef.current = currentTool; }, [currentTool]);
  useEffect(() => { isDrawingRef.current = isDrawing; }, [isDrawing]);
  useEffect(() => { totalDisplayScaleRef.current = totalDisplayScale; }, [totalDisplayScale]);
  useEffect(() => { resScaleRef.current = resScale; }, [resScale]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [state.currentPage]);

  // PDF Height management

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Native listeners with passive: false are needed to reliably prevent scrolling on many touch devices
    const handleTouch = (e: TouchEvent) => {
      if (currentToolRef.current !== Tool.Select) {
        if (e.cancelable) {
          e.preventDefault();
        }
      }
    };

    container.addEventListener('touchstart', handleTouch, { passive: false });
    container.addEventListener('touchmove', handleTouch, { passive: false });

    return () => {
      container.removeEventListener('touchstart', handleTouch);
      container.removeEventListener('touchmove', handleTouch);
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect) {
          setContainerDimensions({
            width: entry.contentRect.width,
            height: entry.contentRect.height
          });
        }
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setDimensions({ width: window.innerWidth, height: window.innerHeight - 80 });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);


  const stageWidth = Math.max(200, pdfInternalWidth * totalDisplayScale);
  const stageHeight = Math.max(activeHeight, (pdfHeight + 40) * totalDisplayScale);

  const handlePointerDown = useCallback((e: any) => {
    // Prevent drawing when clicking on tools or buttons or if not primary pointer
    if (currentToolRef.current === Tool.Select) return;
    
    // Prevent default browser behavior explicitly
    if (e.evt && e.evt.cancelable !== false) {
      e.evt.preventDefault();
      // Also stop propagation to prevent parent containers from reacting
      if (typeof e.evt.stopPropagation === 'function') {
        e.evt.stopPropagation();
      }
    }

    const stage = stageRef.current;
    if (!stage) return;
    
    const pos = stage.getPointerPosition();
    if (!pos) return;

    // Transform stage coordinates to layer coordinates by dividing by the total scale
    const transformedPos = {
      x: pos.x / totalDisplayScaleRef.current,
      y: pos.y / totalDisplayScaleRef.current
    };

    setIsDrawing(true);
    isDrawingRef.current = true;
    
    // Check for snapping
    let startPoint = transformedPos;
    const snapThreshold = 25 / totalDisplayScaleRef.current;
    let bestSnap: Point | null = null;
    let minSnapDist = Infinity;

    if (currentToolRef.current !== Tool.Eraser) {
      if (stateRef.current.ruler.visible) {
        const rad = (stateRef.current.ruler.rotation * Math.PI) / 180;
        const isCm = stateRef.current.ruler.unit === 'cm';
        const unitStep = isCm ? (96 / 2.54) * stateRef.current.ruler.scale * resScaleRef.current : 96 * stateRef.current.ruler.scale * resScaleRef.current;
        const padding = 10;
        const rWidth = (isCm ? 30 : 12) * unitStep + (padding * 2);
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
        const radius = 280 * stateRef.current.protractor.scale * resScaleRef.current;
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
      width: (currentToolRef.current === Tool.Eraser ? stateRef.current.eraserSize : stateRef.current.brushSize) / totalDisplayScaleRef.current,
    });
  }, [addLine]);

  const handlePointerMove = useCallback((e: any) => {
    // Prevent default browser behavior while moving if we are drawing or not in select mode
    if (currentToolRef.current !== Tool.Select && e.evt && e.evt.cancelable !== false) {
      e.evt.preventDefault();
    }

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
      x: pos.x / totalDisplayScaleRef.current,
      y: pos.y / totalDisplayScaleRef.current
    };
    
    // Imperatively update eraser cursor to avoid React re-render cycles
    if (eraserRef.current) {
      if (currentToolRef.current === Tool.Eraser) {
        eraserRef.current.position(transformedPos);
        eraserRef.current.radius((stateRef.current.eraserSize / 2) / totalDisplayScaleRef.current);
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
    if (moveDist < 2 / totalDisplayScaleRef.current) return;

    let currentPoint = transformedPos;
    const snapThreshold = 25 / totalDisplayScaleRef.current;
    let bestSnap: Point | null = null;
    let minSnapDist = Infinity;

    if (currentToolRef.current !== Tool.Eraser) {
      if (stateRef.current.ruler.visible) {
        const rad = (stateRef.current.ruler.rotation * Math.PI) / 180;
        const isCm = stateRef.current.ruler.unit === 'cm';
        const unitStep = isCm ? (96 / 2.54) * stateRef.current.ruler.scale * resScaleRef.current : 96 * stateRef.current.ruler.scale * resScaleRef.current;
        const padding = 10;
        const rWidth = (isCm ? 30 : 12) * unitStep + (padding * 2);
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
        const radius = 280 * stateRef.current.protractor.scale * resScaleRef.current;
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

      // Reference dimension used during drawing (PDFPage component's width prop)
      // This MUST match the calculation used for resScale in the main component
      const getPageRefWidth = (pageWidth: number) => {
        // activeWidth logic from render phase
        const currentActiveWidth = containerDimensions.width || (window.innerWidth - 480);
        return Math.max(400, currentActiveWidth - 48);
      };

      for (let i = 0; i < state.pdfPages.length; i++) {
        // Update progress UI
        setState(prev => ({ ...prev, currentPage: i }));
        
        const pageInfo = state.pdfPages[i];
        const screenWidth = getPageRefWidth(pageInfo.width);
        
        // Wait for image loading
        const img = new Image();
        img.src = pageInfo.url;
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
      setUploadProgress({ current: 0, total: 0 });
      try {
        const pages = await renderPDFToImages(file, (current, total) => {
          setUploadProgress({ current, total });
        });
        setPDFPages(pages);
        
        // Maintain 1:1 local scale for the tools (accuracy)
        const newScale = 1.0;
        
        updateToolPos('ruler', { ...state.ruler, scale: newScale, visible: false });
        updateToolPos('protractor', { ...state.protractor, scale: newScale, visible: false });
      } catch (err) {
        console.error('PDF Upload failed', err);
      } finally {
        setIsUploading(false);
        setUploadProgress({ current: 0, total: 0 });
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
                      <img src={page.url} alt={`Page ${idx + 1}`} className="w-full h-full object-cover" />
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
            className={`absolute inset-0 p-4 bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:20px_20px] scroll-smooth overflow-auto select-none overscroll-none`}
            style={{ 
              touchAction: currentTool === Tool.Select ? 'auto' : 'none',
              msTouchAction: currentTool === Tool.Select ? 'auto' : 'none'
            }}
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
                <Layer scaleX={totalDisplayScale} scaleY={totalDisplayScale}>
                  {state.pdfPages[state.currentPage] && (
                    <PDFPage 
                      url={state.pdfPages[state.currentPage].url} 
                      width={pdfInternalWidth} 
                      onHeightChange={setPdfHeight}
                    />
                  )}
                </Layer>

                <Layer scaleX={totalDisplayScale} scaleY={totalDisplayScale}>
                  {memoLines}
                  <Circle
                    ref={eraserRef}
                    stroke="#64748b"
                    strokeWidth={1.5 / totalDisplayScale}
                    dash={[4, 4]}
                    opacity={0.5}
                    listening={false}
                    visible={false}
                  />
                </Layer>

                <Layer scaleX={totalDisplayScale} scaleY={totalDisplayScale}>
                  <Ruler 
                    state={state.ruler} 
                    onChange={(s) => updateToolPos('ruler', s)} 
                    documentScale={totalDisplayScale}
                    resolutionScale={resScale}
                    draggable={currentTool === Tool.Select}
                    listening={currentTool === Tool.Select}
                  />
                  <BarProtractor 
                    state={state.protractor} 
                    onChange={(s) => updateToolPos('protractor', s)} 
                    documentScale={totalDisplayScale}
                    resolutionScale={resScale}
                    draggable={currentTool === Tool.Select}
                    listening={currentTool === Tool.Select}
                  />
                </Layer>
              </Stage>
            </div>
          </div>

          <div className="absolute bottom-4 right-4 flex flex-col items-end gap-2 z-30 pointer-events-none">
            {/* Tool Size Control */}
            <div 
              className="flex items-center gap-3 bg-white/95 backdrop-blur-sm border-2 border-bento-border px-4 py-2 rounded-xl shadow-xl group transition-all hover:bg-white pointer-events-auto"
              onPointerDown={(e) => e.stopPropagation()} 
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()} 
            >
              <span className="text-[10px] font-black whitespace-nowrap text-slate-500 uppercase tracking-widest select-none">Tool Size</span>
              <Slider 
                key="tool-size-slider"
                value={[state.ruler.scale || 1]} 
                onValueChange={(val: any) => {
                  const safeVal = Array.isArray(val) ? val[0] : val;
                  if (typeof safeVal === 'number' && !isNaN(safeVal)) {
                    setToolScale(safeVal);
                  }
                }} 
                min={0.5} 
                max={3.0} 
                step={0.1}
                className="w-32 cursor-pointer"
              />
              <div className="flex items-center gap-2 min-w-[70px]">
                <span className="text-[10px] font-mono font-bold w-12 text-center text-slate-700">
                  {Math.round((state.ruler.scale || 1) * 100)}%
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setToolScale(1.0);
                  }}
                  className="p-1 hover:bg-slate-200 rounded-md transition-colors text-slate-400 hover:text-slate-600"
                  title="Reset to 100%"
                >
                  <RotateCw size={14} />
                </button>
              </div>
            </div>

            {/* Document Zoom Control */}
            <div className="flex items-center gap-2 bg-white/90 backdrop-blur border-2 border-bento-border p-1.5 rounded-xl shadow-lg pointer-events-auto">
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
                <button 
                  className="bento-tool-btn hover:bg-amber-100 border-amber-200"
                  onClick={() => updateToolPos('ruler', { ...state.ruler, unit: state.ruler.unit === 'cm' ? 'in' : 'cm' })}
                  title={`Switch to ${state.ruler.unit === 'cm' ? 'Inches' : 'Centimeters'}`}
                >
                  <span className="text-[10px] font-black">{state.ruler.unit === 'cm' ? 'CM' : 'IN'}</span>
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
                        <span className="text-[10px] font-mono bg-slate-100 px-1.5 py-0.5 rounded">
                          {Math.round((state.ruler.scale || 1) * 100)}%
                        </span>
                      </div>
                      <Slider
                        value={[state.ruler.scale || 1]}
                        min={0.5}
                        max={3.0}
                        step={0.1}
                        onValueChange={(val: any) => {
                          const safeVal = Array.isArray(val) ? val[0] : val;
                          if (typeof safeVal === 'number' && !isNaN(safeVal)) {
                            setToolScale(safeVal);
                          }
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
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] flex flex-col items-center justify-center p-6">
            <div className="bg-white p-8 rounded-3xl border-4 border-bento-border shadow-[8px_8px_0px_0px_#0f172a] text-center w-full max-w-sm">
                <div className="w-16 h-16 border-8 border-slate-100 border-t-bento-primary rounded-full animate-spin mx-auto mb-6" />
                <h2 className="text-2xl font-black uppercase tracking-tighter text-slate-900 leading-tight">
                  {isExporting ? "Generating PDF" : "Processing PDF"}
                </h2>
                <p className="text-xs font-bold text-slate-500 uppercase mt-2 tracking-widest mb-6">
                  {isExporting ? "Processing all pages and annotations..." : `Optimizing ${uploadProgress.total} pages for digital whiteboard...`}
                </p>

                <div className="w-full bg-slate-100 rounded-full h-4 border-2 border-bento-border overflow-hidden mb-2">
                  <div 
                    className="bg-bento-primary h-full transition-all duration-300" 
                    style={{ 
                      width: isExporting 
                        ? `${((state.currentPage + 1) / state.pdfPages.length) * 100}%` 
                        : `${(uploadProgress.current / uploadProgress.total) * 100}%` 
                    }}
                  />
                </div>

                <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-slate-400">
                  {isExporting ? (
                    <>
                      <span>{Math.round(((state.currentPage + 1) / state.pdfPages.length) * 100) || 0}% Complete</span>
                      <span>Page {state.currentPage + 1} / {state.pdfPages.length}</span>
                    </>
                  ) : (
                    <>
                      <span>{Math.round((uploadProgress.current / uploadProgress.total) * 100) || 0}% Complete</span>
                      <span>{uploadProgress.current} / {uploadProgress.total} Pages</span>
                    </>
                  )}
                </div>
            </div>
        </div>
      )}
    </div>
  );
};
