# Predii Vehicle Specification Extractor

A RAG pipeline that extracts structured vehicle specifications (torque values, fluid capacities, part numbers) from automotive service manual PDFs using LLMs and semantic retrieval.

**Tested on:** 2014 Ford F-150 Workshop Manual (852 pages)  
**Stack:** React + Vite · Groq Llama 3.1 70B · PDF.js · Character-frequency embeddings

---

## Quick Start

**Prerequisites:** Node.js 18+, free Groq API key

```bash
# 1. Install dependencies
cd predii-improved
npm install

# 2. Add your Groq API key to .env.local
#    Get one free at: https://console.groq.com/keys
GROQ_API_KEY=gsk-your-key-here

# 3. Run
npm run dev
# → http://localhost:3000
```

---

## Pipeline Architecture

```
PDF (852 pages)
    │
    ▼  DocumentProcessor.extractTextWithStructure()
       PDF.js + worker thread (non-blocking)
       Group text items by Y-coordinate (±3px) → reconstruct table rows
       Sort by X-coordinate → restore left→right column order
    │
    ▼  DocumentProcessor.generateSemanticChunks()
       Detect Ford section headers (SECTION 204-01A, GROUP, etc.)
       Split at spec sub-headers (TORQUE SPECIFICATIONS, CAPACITIES…)
       Spec-priority selection: pages with Nm/lb-ft/psi/L embedded first
       Cap: 300 chunks  [was 150 — was randomly dropping torque tables]
       embed_text = "SECTION: 204-01A\nPAGE: 14\nCONTENT: ..."
    │
    ▼  GroqService.getBatchEmbeddings()
       Character-frequency hashing (1536-dim, no API cost)
       Automotive terms (torque, Nm, lb-ft, spec…) weighted 3×
    │
    ▼  GroqService.retrieveRelevantChunks()
       Cosine similarity over all embedded chunks
       Return top-6 passages as context
    │
    ▼  GroqService.extractSpecs()
       Model: llama-3.1-70b-versatile (128K context window)
       temperature=0 — deterministic, prevents value hallucination
       Dual-unit rule: Nm + lb-ft → two separate records
    │
    ▼
VehicleSpec[]  →  JSON  +  CSV
```

---

## Output Format

```json
[
  {
    "component": "Tie-rod End Nut",
    "spec_type": "Torque",
    "value": "115",
    "unit": "Nm",
    "condition": "front suspension",
    "part_number": null,
    "source_page": 22,
    "confidence": 0.92,
    "source_context": "Tighten the tie-rod end jam nut to 115 Nm (85 lb-ft)"
  },
  {
    "component": "Tie-rod End Nut",
    "spec_type": "Torque",
    "value": "85",
    "unit": "lb-ft",
    "condition": "front suspension",
    "source_page": 22,
    "confidence": 0.92,
    "source_context": "Tighten the tie-rod end jam nut to 115 Nm (85 lb-ft)"
  }
]
```

---

## What Was Fixed

| Issue | Root Cause | Fix Applied |
|-------|-----------|-------------|
| Large PDFs hang / parse silently | PDF.js worker not configured | Set `GlobalWorkerOptions.workerSrc` in `index.html` and `DocumentProcessor` constructor |
| Torque spec pages missing from results | Hard cap of 150 chunks randomly excluded spec pages | Raised to 300 chunks with spec-priority selection (pages containing Nm/lb-ft/psi always embedded first) |
| No preset queries | Not implemented | 5 assignment queries pre-loaded as suggested query buttons |
| JSON export missing | Not implemented | Added JSON download alongside CSV |
| Confidence score not shown | Extracted but never rendered | Colour-coded `%` badge in results table (green ≥85%, yellow ≥65%, red below) |
| Architecture tab empty | Placeholder only | Full pipeline diagram + 6 design-decision cards + improvement ideas |
| README was boilerplate | AI Studio default | Replaced with technical README (this file) |

---

## Design Decisions

### Section-Aware Chunking
Each chunk is prefixed with its section breadcrumb before embedding:
```
SECTION: 204-01A: FRONT SUSPENSION
PAGE: 14
CONTENT: With the weight of the vehicle resting on the wheel and tire assemblies,
tighten the cam bolt nut to 350 Nm (258 lb-ft).
```
The embedding captures "front suspension" + "350 Nm" together. A query for "cam bolt torque" retrieves this chunk over an uncontextualised one that just has "350 Nm".

### Table Row Reconstruction
PDF.js returns text items as unordered fragments with (x, y) pixel coordinates. Items within ±3px vertically are grouped into rows and sorted left-to-right, reconstructing table rows like:
```
Cam Bolt Nut (Front Lower Arm)    350    Nm    258    lb-ft
```
Without this, the LLM receives 5 disordered fragments and cannot map value → component.

### Dual-Unit Records
Ford manuals always express torque in Nm and lb-ft on the same row. The LLM is instructed to create two separate records per bolt. This keeps the schema clean (`"value": "350", "unit": "Nm"`) rather than encoding two values in a single string field.

### temperature=0
Spec extraction is factual retrieval, not creative generation. Temperature=0 forces the maximum-likelihood token at every step — preventing the model from rounding values or confusing component names.

### Why Groq (Free Inference)
Groq provides Llama 3.1 70B with 128K context for free. The 128K window means all 6 retrieved chunks fit comfortably with room to spare, unlike GPT-3.5's 4K limit.

---

## Improvement Ideas

1. **Real embeddings** — Replace character-frequency hashing with `text-embedding-3-small` (OpenAI) or `embed-english-v3.0` (Cohere). Would enable semantic understanding: "tightening torque" ≡ "Nm specification".

2. **Table extraction** — `pdfplumber.extract_tables()` in a Python backend recovers structured table data that PDF.js flattens. Most torque specs in the F-150 manual live in formatted tables.

3. **Persistent index** — Cache the vector store in IndexedDB so the same PDF doesn't need re-embedding on every query. Would make repeated queries instant.

4. **Scanned PDF support** — Older Ford manuals are scanned images. Tesseract OCR or Google Cloud Vision would extend coverage to pre-2010 manuals.

5. **Multi-hop retrieval** — Some specs have values on page N but the component name defined on page N−2. A two-stage retrieval (section → subsection) handles cross-page references.

6. **Confidence threshold filter** — Let the user set a minimum confidence slider to hide low-confidence extractions before export.

---

## Tools Used

| Layer | Tool | Why |
|-------|------|-----|
| Frontend | React 19 + Tailwind CSS | Rapid component development |
| Build | Vite 6 | Fast HMR in development |
| PDF Parsing | PDF.js 3.11 | Browser-native, coordinate access for table reconstruction |
| Embeddings | Character-frequency hashing | No API cost, no rate limits, instant |
| LLM | Groq Llama 3.1 70B | Free tier, 128K context, fast inference |
| Output | JSON + CSV | Both formats required by assignment spec |

---

*Predii Technical Assignment · 2014 Ford F-150 Workshop Manual*
