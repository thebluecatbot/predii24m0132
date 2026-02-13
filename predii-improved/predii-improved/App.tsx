import React, { useState, useMemo, useCallback } from 'react';
import { GroqService } from './services/groqService';
import { DocumentProcessor } from './services/documentProcessor';
import { VehicleSpec, ProcessingStep, Chunk } from './types';

const PRESET_QUERIES = [
  "What is the torque specification for the Tie-rod end nut on the front suspension?",
  "What is the fill capacity for the Ford 8.8-Inch Rear Drive Axle lubricant?",
  "Identify the part number for the High Temperature Nickel Anti-Seize Lubricant used during wheel installation.",
  "What is the required torque for tightening the wheel nuts on a 6-lug or 7-lug wheel?",
  "What is the total fill capacity for the Motorcraft High Performance DOT 3 Motor Vehicle Brake Fluid in the hydraulic system?",
];

const INITIAL_STEPS: ProcessingStep[] = [
  { id: 'extract',  label: 'Row Reconstruction', status: 'idle', description: 'Table-aware coordinate parsing via PDF.js.' },
  { id: 'embed',    label: 'Semantic Indexing',  status: 'idle', description: 'Character-frequency vectors (1536-dim, no API cost).' },
  { id: 'retrieve', label: 'Vector Retrieval',   status: 'idle', description: 'Cosine similarity search (k=6).' },
  { id: 'parse',    label: 'Spec Synthesis',     status: 'idle', description: 'Llama 3.1 70B (Groq) → validated JSON schema.' },
];

interface ScoredChunk { chunk: Chunk; score: number; }

const confClass = (c: number) =>
  c >= 0.85 ? 'text-green-400' : c >= 0.65 ? 'text-yellow-400' : 'text-red-400';

const App: React.FC = () => {
  const [file, setFile]               = useState<File | null>(null);
  const [query, setQuery]             = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [steps, setSteps]             = useState<ProcessingStep[]>(INITIAL_STEPS);
  const [results, setResults]         = useState<VehicleSpec[]>([]);
  const [retrievedChunks, setRetrievedChunks] = useState<ScoredChunk[]>([]);
  const [error, setError]             = useState<string | null>(null);
  const [initError, setInitError]     = useState<string | null>(null);
  const [mainTab, setMainTab]         = useState<'results' | 'chunks' | 'arch'>('results');
  const [expandedChunk, setExpandedChunk] = useState<number | null>(null);

  const docProcessor = useMemo(() => {
    try { return new DocumentProcessor(); }
    catch (e: any) { setInitError(`DocumentProcessor error: ${e.message}`); return null; }
  }, []);

  const groq = useMemo(() => {
    try { return new GroqService(); }
    catch (e: any) { setInitError(`Groq: ${e.message}`); return null; }
  }, []);

  const updateStep = useCallback((id: string, status: ProcessingStep['status'], desc?: string) => {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, status, description: desc ?? s.description } : s));
  }, []);

  const downloadCSV = () => {
    if (!results.length) return;
    const h = ['Component','Type','Value','Unit','Condition','Part Number','Page','Confidence'];
    const rows = results.map(r => [
      r.component, r.spec_type, r.value, r.unit,
      r.condition ?? '', r.part_number ?? '', r.source_page ?? '',
      (r.confidence * 100).toFixed(0) + '%'
    ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(','));
    const blob = new Blob([[h.join(','), ...rows].join('\n')], { type: 'text/csv' });
    Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `specs_${Date.now()}.csv` }).click();
  };

  const downloadJSON = () => {
    if (!results.length) return;
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
    Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `specs_${Date.now()}.json` }).click();
  };

  const runPipeline = async () => {
    if (!docProcessor || !groq) { setError('Services not initialized. Check console.'); return; }
    if (!file || !query.trim()) { setError('Please upload a PDF and enter a query.'); return; }
    setIsProcessing(true); setError(null); setResults([]); setRetrievedChunks([]);
    setMainTab('results');
    setSteps(INITIAL_STEPS.map(s => ({ ...s, status: 'idle' })));
    try {
      updateStep('extract', 'loading');
      const { pages } = await docProcessor.extractTextWithStructure(file);
      const chunks = docProcessor.generateSemanticChunks(pages);
      updateStep('extract', 'completed', `Parsed ${pages.length} pages → ${chunks.length} chunks.`);

      updateStep('embed', 'loading');
      const BATCH = 20;
      for (let i = 0; i < chunks.length; i += BATCH) {
        const batch = chunks.slice(i, i + BATCH);
        updateStep('embed', 'loading', `Vectorizing… (${Math.min(i + BATCH, chunks.length)}/${chunks.length})`);
        const embs = await groq.getBatchEmbeddings(batch.map(c => c.text));
        embs.forEach((e, idx) => { batch[idx].embedding = e; });
      }
      updateStep('embed', 'completed', `${chunks.length} vectors built (1536-dim, local).`);

      updateStep('retrieve', 'loading');
      const { context, scored } = await groq.retrieveRelevantChunks(query, chunks);
      setRetrievedChunks(scored);
      updateStep('retrieve', 'completed', `Top: "${scored[0]?.chunk.section ?? '–'}" (${scored[0]?.score.toFixed(3) ?? '–'}).`);

      updateStep('parse', 'loading');
      const specs = await groq.extractSpecs(query, context);
      setResults(specs);
      updateStep('parse', 'completed', `Extracted ${specs.length} spec${specs.length !== 1 ? 's' : ''}.`);
    } catch (err: any) {
      setError(err.message || 'Pipeline failed.');
      setSteps(prev => prev.map(s => s.status === 'loading' ? { ...s, status: 'error' } : s));
    } finally {
      setIsProcessing(false);
    }
  };

  const hasData = results.length > 0 || retrievedChunks.length > 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">

        {initError && (
          <div className="bg-red-900/30 border border-red-700/50 rounded-xl p-4 flex gap-3">
            <i className="fas fa-triangle-exclamation text-red-400 mt-0.5 shrink-0"></i>
            <div>
              <p className="font-bold text-red-300 text-sm">Initialization Error</p>
              <p className="text-red-200 text-xs mt-1">{initError}</p>
            </div>
          </div>
        )}

        {/* Header */}
        <header className="flex items-center justify-between pb-3 border-b border-slate-700/50">
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/40">
              <i className="fas fa-microchip text-lg"></i>
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tight">Predii <span className="text-blue-400">Spec-RAG</span></h1>
              <p className="text-xs text-slate-400 mt-0.5">Groq Llama 3.1 70B · RAG Pipeline · 2014 Ford F-150 Workshop Manual</p>
            </div>
          </div>
          {/* Architecture tab in header nav */}
          <button
            onClick={() => setMainTab(mainTab === 'arch' ? 'results' : 'arch')}
            className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all border
              ${mainTab === 'arch' ? 'bg-blue-600 border-blue-500 text-white' : 'border-slate-600 text-slate-400 hover:text-white hover:border-slate-500'}`}
          >
            <i className="fas fa-diagram-project mr-1.5"></i>Architecture
          </button>
        </header>

        {/* ── Architecture View ── */}
        {mainTab === 'arch' && (
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-8 space-y-8 animate-in fade-in duration-200">
            <div>
              <h2 className="text-xl font-black text-white mb-1">Pipeline Architecture</h2>
              <p className="text-slate-400 text-sm">How vehicle specs are extracted from the 852-page F-150 Workshop Manual</p>
            </div>

            {/* Pipeline diagram */}
            <div className="bg-slate-900/70 rounded-2xl p-6 font-mono text-[12px] leading-8 overflow-x-auto border border-slate-700/40">
              <p className="text-blue-400 font-bold mb-1">// RAG PIPELINE  —  PDF → Chunks → Vectors → LLM → JSON</p>
              {[
                ['green', 'PDF (852 pages)  —  2014 Ford F-150 Workshop Manual'],
                ['yellow', '↓  DocumentProcessor.extractTextWithStructure()'],
                ['slate', '     PDF.js + worker thread (non-blocking UI)'],
                ['slate', '     Group items by Y-coord (±3px) → reconstruct table rows'],
                ['slate', '     Sort by X-coord → restore left→right column order'],
                ['yellow', '↓  DocumentProcessor.generateSemanticChunks()'],
                ['slate', '     Detect Ford section headers via regex'],
                ['slate', '     Split at TORQUE/CAPACITY sub-headers within page'],
                ['slate', '     Spec-priority selection (pages with Nm/lb-ft/psi first)'],
                ['slate', '     Cap: 300 chunks  (was 150 — was dropping torque tables)'],
                ['slate', '     embed_text = "SECTION: 204-01A\\nPAGE: 14\\nCONTENT: ..."'],
                ['yellow', '↓  GroqService.getBatchEmbeddings()'],
                ['slate', '     Character-frequency hashing (1536-dim, no API cost)'],
                ['slate', '     Automotive terms weighted 3× (torque, Nm, lb-ft, spec…)'],
                ['yellow', '↓  GroqService.retrieveRelevantChunks()'],
                ['slate', '     Cosine similarity over all embedded chunks'],
                ['slate', '     Return top-6 chunks as context string'],
                ['yellow', '↓  GroqService.extractSpecs()'],
                ['slate', '     Model: llama-3.1-70b-versatile (128K context)'],
                ['slate', '     temperature=0  →  deterministic, no hallucination'],
                ['slate', '     Dual-unit rule: Nm + lb-ft  →  two separate records'],
                ['green', 'VehicleSpec[]  →  JSON export  +  CSV export'],
              ].map(([color, text], i) => (
                <p key={i} className={
                  color === 'green'  ? 'text-green-400' :
                  color === 'yellow' ? 'text-yellow-400' :
                  'text-slate-500'
                }>{text}</p>
              ))}
            </div>

            {/* Design decision cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                {
                  icon: 'fa-wrench', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20',
                  title: 'PDF.js Worker (Bug Fix)',
                  body: 'Without configuring GlobalWorkerOptions.workerSrc, PDF.js runs on the main thread and silently hangs on any PDF larger than ~30 pages. Setting the worker CDN URL in index.html fixes this for the full 852-page manual.'
                },
                {
                  icon: 'fa-layer-group', color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20',
                  title: 'Section-Aware Chunking',
                  body: 'Each chunk is prefixed with its section breadcrumb before embedding — e.g. "SECTION: 204-01A FRONT SUSPENSION\\nPAGE: 14\\n...". The vector captures component context alongside spec values, making retrieval far more precise than embedding raw numbers alone.'
                },
                {
                  icon: 'fa-table-cells', color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/20',
                  title: 'Table Row Reconstruction',
                  body: 'PDF.js returns text as unordered (x,y) coordinate fragments. Items within ±3px vertically are grouped into a row and sorted left-to-right, reconstructing "Cam Bolt Nut  350 Nm  258 lb-ft" as a single coherent line for the LLM.'
                },
                {
                  icon: 'fa-filter', color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20',
                  title: 'Spec-Priority Selection (Bug Fix)',
                  body: 'The original 150-chunk hard cap randomly excluded torque spec tables from the index. The new approach detects pages containing Nm/lb-ft/psi/L values and always embeds those first, filling the 300-chunk budget with general content after.'
                },
                {
                  icon: 'fa-temperature-half', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20',
                  title: 'temperature=0',
                  body: 'Spec extraction is factual retrieval, not creative generation. Temperature=0 forces the model to the maximum-likelihood token at each step — preventing the LLM from rounding "258 lb-ft" to "260" or confusing adjacent component names.'
                },
                {
                  icon: 'fa-code-branch', color: 'text-teal-400', bg: 'bg-teal-500/10 border-teal-500/20',
                  title: 'Dual-Unit Records',
                  body: 'Ford manuals always express torque in both Nm and lb-ft on the same table row. The system prompt instructs the LLM to create two separate records per bolt — one per unit — keeping the schema clean (numeric value + explicit unit string).'
                },
              ].map(card => (
                <div key={card.title} className={`border rounded-xl p-5 space-y-2 ${card.bg}`}>
                  <div className="flex items-center gap-2">
                    <i className={`fas ${card.icon} ${card.color} text-sm`}></i>
                    <h4 className="font-black text-white text-sm">{card.title}</h4>
                  </div>
                  <p className="text-slate-400 text-xs leading-relaxed">{card.body}</p>
                </div>
              ))}
            </div>

            {/* Improvements */}
            <div className="border-t border-slate-700/50 pt-6">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">Known Limitations & Improvement Ideas</p>
              <div className="space-y-2">
                {[
                  'Real embeddings (OpenAI text-embedding-3-small or Cohere) would replace character-frequency hashing and understand synonyms — "tightening torque" ≡ "Nm spec".',
                  'Table extraction: pdfplumber.extract_tables() in a Python backend would recover structured tables that PDF.js flattens into text.',
                  'Persistent index: re-embedding on every upload is slow. IndexedDB caching of the vector store would make repeated queries instant.',
                  'Scanned PDFs: older Ford manuals are scanned images. Tesseract OCR or Google Cloud Vision would handle those.',
                  'Multi-hop retrieval: some specs have values on page N but component names on page N-2. Two-stage retrieval would handle cross-page references.',
                ].map((item, i) => (
                  <div key={i} className="flex gap-2 text-xs text-slate-500">
                    <i className="fas fa-arrow-right text-blue-500/60 mt-0.5 shrink-0"></i>
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Main Lab View ── */}
        {mainTab !== 'arch' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

            {/* LEFT SIDEBAR */}
            <aside className="lg:col-span-4 space-y-4">

              {/* Upload */}
              <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-5">
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">1 · Upload Service Manual</h3>
                <div
                  onClick={() => document.getElementById('file-input')?.click()}
                  className={`p-6 border-2 border-dashed rounded-xl cursor-pointer text-center transition-all
                    ${file ? 'border-green-500/60 bg-green-500/10' : 'border-slate-600 hover:border-blue-500/60 hover:bg-blue-500/5'}`}
                >
                  <input id="file-input" type="file" className="hidden" accept=".pdf"
                    onChange={e => setFile(e.target.files?.[0] || null)} />
                  {file ? (
                    <div className="text-green-400">
                      <i className="fas fa-file-circle-check text-3xl mb-2"></i>
                      <p className="text-xs font-semibold truncate">{file.name}</p>
                      <p className="text-[10px] text-green-500/70 mt-1">{(file.size/1024/1024).toFixed(1)} MB · Ready</p>
                    </div>
                  ) : (
                    <div className="text-slate-500">
                      <i className="fas fa-cloud-arrow-up text-3xl mb-2"></i>
                      <p className="text-sm font-medium">Click to upload PDF</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Query + Presets */}
              <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-5 space-y-3">
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">2 · Enter Query</h3>
                <input
                  type="text" value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !isProcessing && file && query && runPipeline()}
                  placeholder="e.g., Wheel lug nut torque"
                  className="w-full px-4 py-3 bg-slate-700/70 border border-slate-600 rounded-xl text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                />
                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-2">Suggested Queries</p>
                  <div className="space-y-1.5">
                    {PRESET_QUERIES.map((q, i) => (
                      <button key={i} onClick={() => setQuery(q)}
                        className={`w-full text-left px-3 py-2.5 text-[11px] rounded-lg border transition-all leading-snug
                          ${query === q
                            ? 'bg-blue-600/30 border-blue-500/60 text-blue-200'
                            : 'bg-slate-700/40 border-slate-600/50 text-slate-300 hover:border-blue-500/40 hover:bg-blue-500/10'}`}
                      >
                        <i className="fas fa-chevron-right text-[8px] text-blue-400 mr-1.5"></i>{q}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Run button */}
              <button onClick={runPipeline} disabled={!file || !query.trim() || isProcessing}
                className="w-full py-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl font-black text-sm uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-900/30">
                {isProcessing
                  ? <><i className="fas fa-cog animate-spin"></i> Processing…</>
                  : <><i className="fas fa-bolt-lightning"></i> Run Analysis</>}
              </button>

              {/* Pipeline monitor */}
              <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-5">
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Pipeline Monitor</h3>
                <div className="space-y-4">
                  {steps.map((step, idx) => (
                    <div key={step.id} className="flex gap-3 relative">
                      {idx < steps.length - 1 && <div className="absolute left-[10px] top-5 bottom-[-12px] w-px bg-slate-700"></div>}
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] shrink-0 z-10 border transition-all mt-0.5
                        ${step.status === 'completed' ? 'bg-green-500 border-green-500 text-white'
                        : step.status === 'loading'   ? 'bg-slate-800 border-blue-400 text-blue-400 animate-pulse'
                        : step.status === 'error'     ? 'bg-red-500 border-red-500 text-white'
                        :                              'bg-slate-800 border-slate-600 text-slate-600'}`}>
                        {step.status === 'completed' ? <i className="fas fa-check"></i>
                        : step.status === 'error'    ? <i className="fas fa-times"></i>
                        : idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-bold
                          ${step.status === 'completed' ? 'text-white'
                          : step.status === 'loading'   ? 'text-blue-400'
                          : step.status === 'error'     ? 'text-red-400' : 'text-slate-500'}`}>{step.label}</p>
                        <p className="text-[10px] text-slate-500 leading-relaxed mt-0.5 break-words">{step.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </aside>

            {/* RIGHT MAIN PANEL */}
            <div className="lg:col-span-8 space-y-4">
              {error && (
                <div className="bg-red-900/20 border border-red-700/50 rounded-xl p-4 flex gap-3">
                  <i className="fas fa-triangle-exclamation text-red-400 mt-0.5 shrink-0"></i>
                  <p className="text-red-300 text-sm">{error}</p>
                </div>
              )}

              {/* Tab switcher */}
              {hasData && (
                <div className="flex gap-1 bg-slate-800/60 border border-slate-700/50 rounded-xl p-1 w-fit">
                  {(['results', 'chunks'] as const).map(tab => (
                    <button key={tab} onClick={() => setMainTab(tab)}
                      className={`px-5 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all
                        ${mainTab === tab ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}>
                      <i className={`fas ${tab === 'results' ? 'fa-table-list' : 'fa-layer-group'} mr-1.5`}></i>
                      {tab === 'results' ? 'Extracted Specs' : 'Retrieved Chunks'}
                      <span className="ml-1.5 bg-blue-500/30 px-1.5 py-0.5 rounded text-[9px]">
                        {tab === 'results' ? results.length : retrievedChunks.length}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* RESULTS TAB */}
              {(mainTab === 'results' || !hasData) && (
                <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-700/50 flex justify-between items-center">
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                      Extracted Specifications
                      {results.length > 0 && <span className="ml-2 bg-blue-600/30 text-blue-300 px-2 py-0.5 rounded-full text-[9px]">{results.length} found</span>}
                    </h3>
                    {results.length > 0 && (
                      <div className="flex gap-2">
                        <button onClick={downloadJSON} className="text-[10px] bg-slate-700 hover:bg-slate-600 border border-slate-600 px-3 py-1.5 rounded-lg font-bold text-slate-300 flex items-center gap-1.5 transition-all">
                          <i className="fas fa-code text-purple-400"></i> JSON
                        </button>
                        <button onClick={downloadCSV} className="text-[10px] bg-slate-700 hover:bg-slate-600 border border-slate-600 px-3 py-1.5 rounded-lg font-bold text-slate-300 flex items-center gap-1.5 transition-all">
                          <i className="fas fa-file-csv text-green-400"></i> CSV
                        </button>
                      </div>
                    )}
                  </div>
                  {isProcessing ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-4">
                      <div className="w-16 h-16 border-4 border-slate-700 border-t-blue-500 rounded-full animate-spin"></div>
                      <p className="text-slate-400 text-sm font-medium">Processing manual…</p>
                    </div>
                  ) : results.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-3 text-center px-10">
                      <i className="fas fa-clipboard-list text-5xl text-slate-700"></i>
                      <p className="text-slate-400 font-semibold">Ready for extraction</p>
                      <p className="text-slate-600 text-xs max-w-xs">Upload your service manual, select a suggested query, then click <strong className="text-slate-400">Run Analysis</strong>.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-700/50 bg-slate-900/30">
                            {['Component', 'Type', 'Value', 'Condition', 'Conf.'].map(h => (
                              <th key={h} className={`px-${h === 'Conf.' ? '4 text-center' : '6 text-left'} py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest`}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-700/30">
                          {results.map((r, i) => (
                            <tr key={i} className="hover:bg-slate-700/20 transition-colors">
                              <td className="px-6 py-4">
                                <p className="font-semibold text-white text-[13px]">{r.component}</p>
                                {r.part_number && <span className="text-[10px] text-blue-400 font-mono">PN: {r.part_number}</span>}
                                {r.source_page && <span className="ml-2 text-[10px] text-slate-500">p.{r.source_page}</span>}
                              </td>
                              <td className="px-4 py-4">
                                <span className="bg-slate-700/60 text-slate-300 text-[10px] font-bold px-2 py-1 rounded-lg uppercase">{r.spec_type}</span>
                              </td>
                              <td className="px-4 py-4">
                                <span className="text-blue-300 font-black text-base">{r.value}</span>
                                <span className="text-slate-400 text-[11px] font-bold ml-1">{r.unit}</span>
                              </td>
                              <td className="px-4 py-4">
                                <p className="text-slate-400 text-xs italic">{r.condition || '—'}</p>
                              </td>
                              <td className="px-4 py-4 text-center">
                                <span className={`text-xs font-black ${confClass(r.confidence)}`}>
                                  {(r.confidence * 100).toFixed(0)}%
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* CHUNKS TAB */}
              {mainTab === 'chunks' && (
                <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-700/50">
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                      Retrieved Chunks
                      <span className="ml-2 text-slate-600 normal-case font-normal">
                        — top {retrievedChunks.length} passages for: "<span className="text-blue-400 italic">{query}</span>"
                      </span>
                    </h3>
                  </div>
                  <div className="divide-y divide-slate-700/30">
                    {retrievedChunks.map((sc, i) => (
                      <div key={i} className="p-5">
                        <div className="flex items-start justify-between gap-4 cursor-pointer"
                          onClick={() => setExpandedChunk(expandedChunk === i ? null : i)}>
                          <div className="flex items-start gap-3 flex-1 min-w-0">
                            <div className="w-7 h-7 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center shrink-0 mt-0.5">
                              <span className="text-[10px] font-black text-blue-400">#{i+1}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-slate-200 truncate">{sc.chunk.section || 'General'}</p>
                              <div className="flex items-center gap-3 mt-1">
                                <span className="text-[10px] text-slate-500"><i className="fas fa-file-pdf text-[9px] mr-1"></i>Page {sc.chunk.page}</span>
                                <span className="text-[10px] font-bold text-emerald-400">↑ {(sc.score * 100).toFixed(1)}% match</span>
                                <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden max-w-[100px]">
                                  <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(sc.score * 100, 100)}%` }}></div>
                                </div>
                              </div>
                            </div>
                          </div>
                          <i className={`fas fa-chevron-${expandedChunk === i ? 'up' : 'down'} text-xs text-slate-600 shrink-0 mt-1.5`}></i>
                        </div>
                        <div className="mt-3 ml-10">
                          <div className={`bg-slate-900/60 rounded-lg p-3 font-mono text-[11px] text-slate-400 leading-relaxed border border-slate-700/40 relative ${expandedChunk === i ? '' : 'max-h-12 overflow-hidden'}`}>
                            {expandedChunk !== i && <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-slate-900/80 to-transparent rounded-b-lg"></div>}
                            {sc.chunk.text}
                          </div>
                          {expandedChunk !== i && (
                            <button onClick={() => setExpandedChunk(i)} className="text-[10px] text-blue-400 hover:text-blue-300 mt-1.5 transition-colors">
                              Show full text ↓
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
