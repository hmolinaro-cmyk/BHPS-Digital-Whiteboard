import * as pdfjs from 'pdfjs-dist';
// @ts-expect-error - Vite handles ?url suffix
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

// Configure worker
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

export interface PDFPageInfo {
  url: string;
  width: number;
  height: number;
}

export async function renderPDFToImages(
  file: File, 
  onProgress?: (current: number, total: number) => void
): Promise<PDFPageInfo[]> {
  const data = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data }).promise;
  const numPages = pdf.numPages;
  const pageInfos: PDFPageInfo[] = new Array(numPages);

  // Process pages in parallel chunks to speed up processing
  // Concurrency of 4 is a good balance for most browsers
  const CONCURRENCY = 4;
  const pageIndices = Array.from({ length: numPages }, (_, i) => i + 1);
  
  let processedCount = 0;

  for (let i = 0; i < pageIndices.length; i += CONCURRENCY) {
    const chunk = pageIndices.slice(i, i + CONCURRENCY);
    
    await Promise.all(chunk.map(async (pageNum) => {
      try {
        const page = await pdf.getPage(pageNum);
        // Original viewport at 1.0 scale (72 DPI)
        const originalViewport = page.getViewport({ scale: 1.0 });
        
        // Using 1.6 scale instead of 2.0 - still high res but significantly faster to render and smaller memory footprint
        const viewport = page.getViewport({ scale: 1.6 }); 
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        
        if (context) {
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          
          await page.render({
            canvasContext: context,
            viewport: viewport
          }).promise;
          
          // Using JPEG at 0.85 quality is much faster to encode/decode than PNG and takes ~1/5th the memory
          const url = canvas.toDataURL('image/jpeg', 0.85);
          
          pageInfos[pageNum - 1] = {
            url,
            width: originalViewport.width,
            height: originalViewport.height
          };
          
          processedCount++;
          onProgress?.(processedCount, numPages);
        }
      } catch (err) {
        console.error(`Failed to render page ${pageNum}`, err);
      }
    }));

    // Small yield to UI thread after each chunk
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  return pageInfos.filter(info => !!info);
}
