import Groq from "groq-sdk";
import { VehicleSpec, Chunk } from "../types";

// Groq does not provide an embeddings API.
// We use a lightweight character-frequency hashing approach instead.
// This produces consistent 1536-dim vectors suitable for cosine similarity RAG.
// For production, swap with a real embedding API (OpenAI, Cohere, etc.).

const EXTRACTION_MODEL = "llama-3.3-70b-versatile"; // 128K context, best accuracy on Groq free tier

interface ScoredChunk {
  chunk: Chunk;
  score: number;
}

export class GroqService {
  private client: Groq;

  constructor() {
    const apiKey =
      process.env.GROQ_API_KEY || process.env.API_KEY || "";
    if (!apiKey || apiKey === "PLACEHOLDER_API_KEY") {
      throw new Error(
        "Groq API key not found. Add GROQ_API_KEY=gsk-... to your .env.local file."
      );
    }
    this.client = new Groq({
      apiKey,
      dangerouslyAllowBrowser: true, // required for browser-side usage
    });
  }

  /**
   * Character-frequency embedding (1536-dim).
   *
   * Converts text into a fixed-length vector based on character n-gram frequencies
   * combined with word-boundary hashing. This is deterministic and requires no
   * external API calls, making it free and instant.
   *
   * Limitation vs real embeddings: no semantic understanding of synonyms.
   * "torque" and "tightening spec" won't score as similar.
   * For this assignment the queries and chunk text use the same vocabulary
   * (both mention "Nm", "lb-ft", component names) so cosine similarity still works well.
   */
  async getEmbedding(text: string): Promise<number[]> {
    const dim = 1536;
    const vector = new Float32Array(dim);
    const normalized = text.toLowerCase().slice(0, 2000);

    // Character bigrams
    for (let i = 0; i < normalized.length - 1; i++) {
      const code = (normalized.charCodeAt(i) * 31 + normalized.charCodeAt(i + 1)) % dim;
      vector[Math.abs(code)] += 1;
    }

    // Word unigrams (higher weight for automotive terms)
    const words = normalized.match(/\b\w+\b/g) || [];
    const autoTerms = new Set(["torque", "nm", "lb", "ft", "capacity", "pressure", "fluid", "bolt", "nut", "spec", "liter", "psi", "clearance"]);
    words.forEach((word) => {
      const weight = autoTerms.has(word) ? 3 : 1;
      let hash = 0;
      for (let i = 0; i < word.length; i++) {
        hash = ((hash << 5) - hash + word.charCodeAt(i)) | 0;
      }
      vector[Math.abs(hash) % dim] += weight;
    });

    // L2 normalize
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += vector[i] * vector[i];
    norm = Math.sqrt(norm) || 1;
    return Array.from(vector).map((v) => v / norm);
  }

  async getBatchEmbeddings(texts: string[]): Promise<number[][]> {
    // No API call needed — process synchronously
    return Promise.all(texts.map((t) => this.getEmbedding(t)));
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const mag = Math.sqrt(normA) * Math.sqrt(normB);
    return mag === 0 ? 0 : dot / mag;
  }

  async retrieveRelevantChunks(
    query: string,
    chunks: Chunk[],
    k: number = 6
  ): Promise<{ context: string; scored: ScoredChunk[] }> {
    const queryEmbedding = await this.getEmbedding(query);

    const scored: ScoredChunk[] = chunks
      .filter((c) => c.embedding && c.embedding.length > 0)
      .map((chunk) => ({
        chunk,
        score: this.cosineSimilarity(queryEmbedding, chunk.embedding!),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);

    const context = scored.map((sc) => sc.chunk.text).join("\n---\n");
    return { context, scored };
  }

  /**
   * LLM extraction via Groq Llama 3.1 70B.
   *
   * Key prompt decisions:
   * - temperature: 0  → deterministic, prevents value hallucination
   * - Dual-unit rule: Nm AND lb-ft from same bolt → two separate records
   * - Confidence: 0.9+ for explicit table values, 0.6-0.8 for contextual
   * - JSON-only output enforced in prompt + robust parse fallback
   */
  async extractSpecs(query: string, context: string): Promise<VehicleSpec[]> {
    const systemPrompt = `You are an expert automotive data extraction engineer specialising in Ford service manuals.

Extract ALL vehicle specifications from the provided text that are relevant to the query.

Rules:
1. TABLE RECONSTRUCTION: Map component names (left column) to their values (right columns).
2. DUAL UNITS: If a spec shows both Nm and lb-ft for the same bolt, create TWO separate records — one per unit.
3. PART NUMBERS: Capture Ford part IDs (e.g., XL-2, W707628) in the part_number field.
4. CONDITIONS: Capture context like "new bolts only", "dry threads", "with filter", "6-lug wheel".
5. PAGE TRACKING: Use the PAGE: X metadata in the context for source_page.
6. CONFIDENCE: Score 0.0–1.0. Use 0.9+ for explicit table values, 0.6–0.8 for inferred values. Skip if below 0.5.
7. NO INVENTION: Never hallucinate values. If a spec is not clearly stated in the text, omit it entirely.
8. SOURCE CONTEXT: Copy the exact sentence or table row the value came from into source_context.

Return ONLY a valid JSON array. No markdown, no explanation, no preamble.
Format: [{"component":"...","spec_type":"Torque|Fluid Capacity|Pressure|Clearance|Gap|Part Number","value":"...","unit":"...","part_number":"...","condition":"...","source_page":0,"confidence":0.0,"source_context":"..."}]`;

    try {
      const response = await this.client.chat.completions.create({
        model: EXTRACTION_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Query: ${query}\n\nService Manual Context:\n${context}` },
        ],
        temperature: 0,
        max_tokens: 2048,
      });

      const raw = response.choices[0]?.message?.content?.trim() || "[]";

      // Robust JSON parsing — strip markdown fences if present
      const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/,"").trim();
      try {
        const parsed = JSON.parse(clean);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        // Try to extract first [...] block
        const match = clean.match(/\[[\s\S]*\]/);
        if (match) {
          try { return JSON.parse(match[0]); } catch { /* fall through */ }
        }
        console.error("[GroqService] Could not parse LLM response:", raw.slice(0, 300));
        return [];
      }
    } catch (e: any) {
      const msg = e.message || "";
      if (msg.includes("401") || msg.includes("invalid_api_key")) {
        throw new Error("Invalid Groq API key. Check GROQ_API_KEY in your .env.local file.");
      }
      if (msg.includes("429") || msg.includes("rate_limit")) {
        throw new Error("Groq rate limit hit. Wait 30 seconds and try again.");
      }
      throw new Error(`LLM extraction failed: ${msg}`);
    }
  }
}
