import React, { useState, useMemo, useCallback } from 'react';
import { OpenAIService } from './services/openaiService';
import { DocumentProcessor } from './services/documentProcessor';
import { VehicleSpec, ProcessingStep, Chunk } from './types';

// ─── Preset queries tuned for the 2014 Ford F-150 Workshop Manual ─────────────
const PRESET_QUERIES = [
  "Torque for cam bolt front suspension lower arm",
  "Torque for stabilizer bar bracket and link nuts",
  "Torque for tie rod end jam nut",
  "Torque for wheel lug nuts",
  "Torque for shock absorber mounting bolts",
  "Engine oil fluid capacity",
  "Coolant and transmission fluid capacity",
  "Tire pressure specification PSI",
  "Ball joint torque specification",
  "Brake caliper anchor bracket bolt torque",
];

const INITIAL_STEPS: ProcessingStep[] = [
  { id: 'extract', label: 'Row Reconstruction',  status: 'idle', description: 'Table-aware coordinate parsing via PDF.js.' },
  { id: 'embed',   label: 'Semantic Indexing',   status: 'idle', description: 'Generating section-aware vectors (text-embedding-3-small).' },
  { id: 'retrieve',label: 'Vector Retrieval',    status: 'idle', description: 'Cosine similarity search (k=6).' },
  { id: 'parse',   label: 'Spec Synthesis',      status: 'idle', description: 'GPT-3.5-Turbo → validated JSON schema.' },
];

const App: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [query, setQuery] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [steps, setSteps] = useState<ProcessingStep[]>(INITIAL_STEPS);
  const [results, setResults] = useState<VehicleSpec[]>([]);
  const [error, setError] = useState<string | null>(null);

  const docProcessor = useMemo(() => new DocumentProcessor(), []);
  const openai = useMemo(() => new OpenAIService(), []);

  const updateStep = useCallback((id: string, status: ProcessingStep['status'], description?: string) => {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, status, description: description ?? s.description } : s));
  }, []);

  const runPipeline = async () => {
    if (!file || !query.trim()) return;
    setIsProcessing(true);
    setError(null);
    setResults([]);

    try {
      // Step 1: Extract text from PDF
      updateStep('extract', 'loading');
      const { text, pages } = await docProcessor.extractTextWithStructure(file);
      const chunks = docProcessor.generateSemanticChunks(pages);
      updateStep('extract', 'completed', `Parsed ${pages.length} pages → ${chunks.length} semantic chunks.`);

      // Step 2: Embeddings
      updateStep('embed', 'loading');
      const BATCH = 20;
      for (let i = 0; i < chunks.length; i += BATCH) {
        const batch = chunks.slice(i, i + BATCH);
        updateStep('embed', 'loading', `Vectorizing… (${Math.min(i + BATCH, chunks.length)}/${chunks.length})`);
        const embeddings = await openai.getBatchEmbeddings(batch.map(c => c.text));
        embeddings.forEach((emb, idx) => { batch[idx].embedding = emb; });
      }
      updateStep('embed', 'completed', `${chunks.length} vectors built (text-embedding-3-small, 1536-dim).`);

      // Step 3: Retrieval
      updateStep('retrieve', 'loading');
      const { context, scored } = await openai.retrieveRelevantChunks(query, chunks);
      const topSection = scored[0]?.chunk.section ?? 'Unknown';
      updateStep('retrieve', 'completed', `Top match: "${topSection}" (score: ${scored[0]?.score.toFixed(3) ?? '–'}).`);

      // Step 4: LLM Extraction
      updateStep('parse', 'loading');
      const specs = await openai.extractSpecs(query, context);
      setResults(specs);
      updateStep('parse', 'completed', `Extracted ${specs.length} specification${specs.length !== 1 ? 's' : ''}.`);

    } catch (err: any) {
      setError(err.message || "Pipeline execution failed.");
      updateStep('extract', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-white p-6">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* ─── Header ─────────────────────────────────────────────────────────────── */}
        <header className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg">
              <i className="fas fa-microchip text-lg"></i>
            </div>
            <div>
              <h1 className="text-4xl font-black tracking-tight">
                Predii <span className="text-blue-400">Spec-RAG</span>
              </h1>
              <p className="text-sm text-slate-400">OpenAI GPT-3.5-Turbo + Vector Search</p>
            </div>
          </div>
        </header>

        {/* ─── Main Grid ──────────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* ─── LEFT: Input Controls ─────────────────────────────────────────────────── */}
          <div className="space-y-6">
            
            {/* File Upload */}
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 space-y-4">
              <h3 className="text-sm font-bold text-slate-300 uppercase tracking-widest">Upload PDF</h3>
              <div
                onClick={() => document.getElementById('file-input')?.click()}
                className={`relative p-8 border-2 border-dashed rounded-lg cursor-pointer text-center transition-all ${
                  file ? 'border-green-500 bg-green-500/10' : 'border-slate-600 hover:border-blue-500'
                }`}
              >
                <input
                  id="file-input"
                  type="file"
                  className="hidden"
                  accept=".pdf"
                  onChange={e => setFile(e.target.files?.[0] || null)}
                />
                {file ? (
                  <div className="text-green-400">
                    <i className="fas fa-check-circle text-3xl mb-2"></i>
                    <p className="text-sm font-semibold truncate">{file.name}</p>
                    <p className="text-xs text-green-300 mt-1">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
                  </div>
                ) : (
                  <div className="text-slate-400">
                    <i className="fas fa-cloud-arrow-up text-3xl mb-2"></i>
                    <p className="text-sm font-semibold">Drop PDF or click</p>
                    <p className="text-xs text-slate-500 mt-1">Service manuals welcome</p>
                  </div>
                )}
              </div>
            </div>

            {/* Query Input */}
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 space-y-4">
              <h3 className="text-sm font-bold text-slate-300 uppercase tracking-widest">Query</h3>
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && runPipeline()}
                placeholder="e.g., Wheel lug nut torque"
                className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            {/* Presets */}
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
              <p className="text-xs text-slate-400 mb-3 font-bold uppercase tracking-widest">Quick Queries</p>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {PRESET_QUERIES.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => setQuery(q)}
                    className="w-full text-left px-3 py-2 text-xs bg-slate-700/50 hover:bg-blue-600/30 border border-slate-600/50 rounded transition-all text-slate-300 hover:text-blue-300"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            {/* Run Button */}
            <button
              onClick={runPipeline}
              disabled={!file || !query || isProcessing}
              className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:opacity-50 rounded-lg font-bold uppercase tracking-wider transition-all"
            >
              {isProcessing ? (
                <><i className="fas fa-spinner animate-spin mr-2"></i>Processing...</>
              ) : (
                <><i className="fas fa-play mr-2"></i>Extract Specs</>
              )}
            </button>
          </div>

          {/* ─── RIGHT: Results & Pipeline Status ────────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Pipeline Steps */}
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 space-y-3">
              <h3 className="text-sm font-bold text-slate-300 uppercase tracking-widest mb-4">Pipeline Monitor</h3>
              {steps.map(step => (
                <div key={step.id} className="space-y-1">
                  <div className="flex items-center gap-2 text-sm">
                    {step.status === 'completed' && <i className="fas fa-check-circle text-green-500"></i>}
                    {step.status === 'loading' && <i className="fas fa-spinner animate-spin text-blue-500"></i>}
                    {step.status === 'idle' && <i className="fas fa-circle text-slate-600"></i>}
                    {step.status === 'error' && <i className="fas fa-exclamation-circle text-red-500"></i>}
                    <span className="font-semibold text-slate-200">{step.label}</span>
                  </div>
                  <p className="text-xs text-slate-400 ml-6">{step.description}</p>
                </div>
              ))}
            </div>

            {/* Error Display */}
            {error && (
              <div className="bg-red-900/20 border border-red-700 rounded-lg p-4">
                <p className="text-sm text-red-200">
                  <i className="fas fa-exclamation-triangle mr-2"></i>
                  {error}
                </p>
              </div>
            )}

            {/* Results Table */}
            {results.length > 0 && (
              <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 space-y-4">
                <h3 className="text-sm font-bold text-slate-300 uppercase tracking-widest">
                  Extracted Specifications ({results.length})
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="border-b border-slate-600">
                      <tr className="text-slate-400">
                        <th className="text-left py-2 px-3">Component</th>
                        <th className="text-left py-2 px-3">Type</th>
                        <th className="text-left py-2 px-3">Value</th>
                        <th className="text-left py-2 px-3">Confidence</th>
                      </tr>
                    </thead>
                    <tbody className="space-y-2">
                      {results.slice(0, 10).map((spec, i) => (
                        <tr key={i} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                          <td className="py-2 px-3 text-slate-200">{spec.component}</td>
                          <td className="py-2 px-3 text-slate-400">{spec.spec_type}</td>
                          <td className="py-2 px-3 text-blue-300">{spec.value} {spec.unit}</td>
                          <td className="py-2 px-3">
                            <span className={`px-2 py-1 rounded text-xs font-semibold ${
                              spec.confidence >= 0.85 ? 'bg-green-500/20 text-green-300' :
                              spec.confidence >= 0.65 ? 'bg-yellow-500/20 text-yellow-300' :
                              'bg-red-500/20 text-red-300'
                            }`}>
                              {(spec.confidence * 100).toFixed(0)}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {results.length > 10 && (
                  <p className="text-xs text-slate-400 text-center">
                    ... and {results.length - 10} more results
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
