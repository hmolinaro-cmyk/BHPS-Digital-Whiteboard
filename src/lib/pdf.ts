import * as pdfjs from 'pdfjs-dist';
// @ts-expect-error - Vite handles ?url suffix
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

// Configure worker
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

export async function renderPDFToImages(file: File): Promise<string[]> {
  const data = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data }).promise;
  const imageUrls: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2 }); // High res for Promethean boards
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    
    if (context) {
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      
      const renderTask = page.render({
        canvasContext: context,
        viewport: viewport
      });
      await renderTask.promise;
      
      imageUrls.push(canvas.toDataURL('image/png'));
    }
  }

  return imageUrls;
}
