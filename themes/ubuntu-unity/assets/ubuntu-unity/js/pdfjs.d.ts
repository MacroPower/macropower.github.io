// The slice of the pdf.js API cv.ts uses. _partials/ui/script.html shims
// "pdfjs-dist" to the build vendored under assets/ubuntu-unity/third_party/pdf-js/, which
// ships without type declarations.
declare module "pdfjs-dist" {
  export interface PageViewport {
    width: number;
    height: number;
  }

  export interface PDFPageProxy {
    getViewport(opts: { scale: number }): PageViewport;
    render(opts: { canvas: HTMLCanvasElement; viewport: PageViewport }): { promise: Promise<void> };
  }

  export interface PDFDocumentProxy {
    numPages: number;
    getPage(n: number): Promise<PDFPageProxy>;
  }

  export const GlobalWorkerOptions: { workerSrc: string };

  export function getDocument(params: { url: string; enableHWA?: boolean }): {
    promise: Promise<PDFDocumentProxy>;
  };
}
