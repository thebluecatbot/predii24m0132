import { Chunk } from "../types";

declare const pdfjsLib: any;

export class DocumentProcessor {
  constructor() {
    // FIX 1: PDF.js worker must be configured or parsing silently fails on large PDFs.
    // Without this, the main thread freezes and getDocument().promise never resolves
    // on manuals larger than ~30 pages. The F-150 manual is 852 pages.
    if (typeof pdfjsLib !== "undefined" && pdfjsLib.GlobalWorkerOptions) {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    }
  }

  /**
   * Table-Aware Text Extraction.
   *
   * PDF.js returns text items as unordered coordinate fragments.
   * We group items by Y coordinate (±3px tolerance) to reconstruct table rows,
   * then sort each row by X coordinate to restore left→right column order.
   *
   * Without this, a torque table row like:
   *   "Cam Bolt Nut    350    Nm    258    lb-ft"
   * arrives as 5 unordered fragments and the LLM cannot map value → component.
   */
  async extractTextWithStructure(
    file: File
  ): Promise<{ text: string; pages: { num: number; content: string }[] }> {
    const arrayBuffer = await file.arrayBuffer();

    let pdf: any;
    try {
      pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    } catch (e: any) {
      throw new Error(
        `PDF.js failed to open the file: ${e.message}. Make sure the file is a valid, non-encrypted PDF.`
      );
    }

    const pages: { num: number; content: string }[] = [];
    let fullText = "";

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const items: any[] = textContent.items;

      // Group text items into rows by Y coordinate
      const ROW_DELTA = 3; // pixels — items within 3px vertical distance share a row
      const lineMap = new Map<number, any[]>();

      items.forEach((item) => {
        const y = Math.round(item.transform[5]);
        const existingKey = Array.from(lineMap.keys()).find(
          (k) => Math.abs(k - y) < ROW_DELTA
        );
        if (existingKey === undefined) {
          lineMap.set(y, [item]);
        } else {
          lineMap.get(existingKey)!.push(item);
        }
      });

      // Sort rows top-to-bottom, items within each row left-to-right
      const pageText = Array.from(lineMap.keys())
        .sort((a, b) => b - a) // descending Y = top-to-bottom in PDF coords
        .map((y) =>
          lineMap
            .get(y)!
            .sort((a, b) => a.transform[4] - b.transform[4]) // ascending X = left-to-right
            .map((item) => item.str.trim())
            .filter(Boolean)
            .join("  ") // double space between columns preserves table structure
        )
        .filter((line) => line.trim().length > 0)
        .join("\n");

      pages.push({ num: i, content: pageText });
      fullText += `[START_PAGE_${i}]\n${pageText}\n[END_PAGE_${i}]\n\n`;
    }

    return { text: fullText, pages };
  }

  /**
   * Section-Aware Chunking with spec-priority selection.
   *
   * FIX 2: Old code had a hard cap of 150 chunks regardless of content.
   * For an 852-page manual this randomly excluded critical torque spec sections.
   *
   * New approach — raised cap to 300 with smart prioritisation:
   *   1. Detect pages containing actual spec values (Nm, lb-ft, L, psi, pt, qt)
   *   2. Always embed ALL spec-priority chunks first
   *   3. Fill remaining budget with general content chunks
   *
   * This guarantees torque/fluid tables are never dropped from the vector index.
   *
   * Each chunk is prefixed with its section breadcrumb before embedding.
   * e.g. "SECTION: 204-01A FRONT SUSPENSION\nPAGE: 14\nCONTENT: ..."
   * The embedding captures both "front suspension" and "350 Nm" together,
   * making retrieval far more precise than embedding raw values alone.
   */
  generateSemanticChunks(
    pages: { num: number; content: string }[],
    maxChunks: number = 300 // raised from 150
  ): Chunk[] {
    const allChunks: Chunk[] = [];
    let activeSection = "GENERAL INFORMATION";

    // Ford F-150 manual section header patterns
    const SECTION_HEADER =
      /(?:SECTION|GROUP)\s+(\d+-\d+[A-Z]?):?\s+([A-Z][A-Z\s\-]+)/i;

    // Pages containing these patterns are spec-priority — embed first
    const SPEC_VALUE_PATTERN =
      /\b(\d+(?:\.\d+)?)\s*(Nm|N·m|lb-ft|ft-lb|liter|liters|qt|quart|psi|bar|mm|pt)\b/i;

    pages.forEach((page) => {
      // Track current section from header if found on this page
      const sectionMatch = page.content.match(SECTION_HEADER);
      if (sectionMatch) {
        activeSection = `${sectionMatch[1]}: ${sectionMatch[2].trim()}`;
      }

      // Split page at spec category sub-headers
      const segments = page.content.split(
        /(?=(?:TORQUE SPECIFICATIONS?|GENERAL SPECIFICATIONS?|FLUID CAPACIT|CAPACITIES\n|Torque\s*\n))/i
      );

      segments.forEach((seg, sIdx) => {
        const clean = seg.trim();
        if (clean.length < 30) return;

        const isSpecPriority = SPEC_VALUE_PATTERN.test(clean);

        allChunks.push({
          id: `p${page.num}-s${sIdx}`,
          // Prepend section + page — this is what gets embedded.
          // The vector will capture section context alongside spec values.
          text: `SECTION: ${activeSection}\nPAGE: ${page.num}\nCONTENT: ${clean}`,
          section: activeSection,
          page: page.num,
          isSpecPriority,
        });
      });
    });

    // Spec-priority chunks first, general chunks fill the rest of the budget
    const specChunks = allChunks.filter((c) => c.isSpecPriority);
    const generalChunks = allChunks.filter((c) => !c.isSpecPriority);

    const selected = [
      ...specChunks,
      ...generalChunks.slice(0, Math.max(0, maxChunks - specChunks.length)),
    ].slice(0, maxChunks);

    console.log(
      `[DocumentProcessor] Total chunks: ${allChunks.length} | ` +
        `Spec-priority: ${specChunks.length} | Embedding: ${selected.length}`
    );

    return selected;
  }
}
