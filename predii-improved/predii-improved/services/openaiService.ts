import OpenAI from "openai";
import { VehicleSpec, Chunk } from "../types";

const EXTRACTION_MODEL = "gpt-3.5-turbo";  // Cost-effective model
const EMBEDDING_MODEL = "text-embedding-3-small";  // Small embeddings model

export class OpenAIService {
  private client: OpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY || '';
    if (!apiKey || apiKey === 'PLACEHOLDER_API_KEY') {
      console.warn("[OpenAIService] No API key found. Set OPENAI_API_KEY in .env.local");
    }
    // Enable browser environment - necessary for client-side LLM calls
    this.client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
  }

  async getEmbedding(text: string): Promise<number[]> {
    try {
      const response = await this.client.embeddings.create({
        model: EMBEDDING_MODEL,
        input: text,
      });
      if (!response.data?.[0]?.embedding) throw new Error("Empty embedding response");
      return response.data[0].embedding;
    } catch (e: any) {
      const batch = await this.getBatchEmbeddings([text]);
      return batch[0];
    }
  }

  async getBatchEmbeddings(texts: string[]): Promise<number[][]> {
    try {
      // OpenAI embeddings API supports batch processing natively
      const response = await this.client.embeddings.create({
        model: EMBEDDING_MODEL,
        input: texts,
      });

      if (!response.data?.length) throw new Error("No embeddings returned");
      
      // Sort by index to maintain order
      return response.data
        .sort((a, b) => a.index - b.index)
        .map(item => item.embedding);
    } catch (e: any) {
      const msg = e.message || '';
      if (msg.includes('API_KEY') || msg.includes('401') || msg.includes('403'))
        throw new Error("Invalid or missing OpenAI API key. Check your .env.local file.");
      if (msg.includes('429') || msg.includes('quota') || msg.includes('rate_limit'))
        throw new Error("OpenAI API rate limit exceeded. Wait a moment and retry.");
      throw new Error(`Embedding failed: ${msg}`);
    }
  }

  async retrieveRelevantChunks(
    query: string,
    chunks: Chunk[],
    k: number = 6
  ): Promise<{ context: string; scored: Array<{ chunk: Chunk; score: number }> }> {
    const queryEmbedding = await this.getEmbedding(query);
    const scored = chunks
      .filter(c => c.embedding && c.embedding.length > 0)
      .map(chunk => ({ chunk, score: this.cosineSimilarity(queryEmbedding, chunk.embedding!) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
    const context = scored.map(sc => sc.chunk.text).join("\n---\n");
    return { context, scored };
  }

  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length || vecA.length === 0) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dot += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    const mag = Math.sqrt(normA) * Math.sqrt(normB);
    return mag === 0 ? 0 : dot / mag;
  }

  async extractSpecs(query: string, context: string): Promise<VehicleSpec[]> {
    const systemInstruction = `You are an expert automotive data extraction engineer specialising in Ford service manuals.

Extract ALL vehicle specifications from the provided text relevant to the query.

Rules:
1. TABLE RECONSTRUCTION: Map component names (left column) to values (right columns).
2. DUAL UNITS: If a spec shows Nm AND lb-ft for the same bolt, create TWO separate entries.
3. PART NUMBERS: Capture Ford part IDs (e.g., W707628, 5A313-AA) in part_number.
4. CONDITIONS: Capture notes like "new bolts only", "dry threads", "engine cold", "with filter".
5. PAGE TRACKING: Use "PAGE: X" metadata in context for source_page.
6. CONFIDENCE: 0.9+ for explicit table values, 0.6-0.8 for contextual, skip if below 0.5.
7. NO INVENTION: Never hallucinate values. If not clearly stated, omit it.
8. SOURCE CONTEXT: Copy the raw sentence/row the value came from.

Return a JSON array of objects with these fields:
- component (string): Name of the component
- spec_type (string): One of [Torque, Fluid Capacity, Pressure, Clearance, Gap, Part Number, Temperature, Voltage]
- value (string): The specification value
- unit (string): Unit of measurement
- part_number (string, optional): Ford part number if applicable
- condition (string, optional): Special conditions for this spec
- source_page (number, optional): Page number from manual
- confidence (number): 0-1 confidence score
- source_context (string): Raw text where this was found`;

    try {
      const response = await this.client.chat.completions.create({
        model: EXTRACTION_MODEL,
        max_tokens: 2048,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: systemInstruction
          },
          {
            role: "user",
            content: `Query: ${query}\n\nService Manual Context:\n${context}`
          }
        ]
      });

      const text = response.choices[0]?.message?.content || '';
      
      try {
        // Extract JSON from response (may be wrapped in markdown code blocks)
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        const jsonStr = jsonMatch ? jsonMatch[0] : text;
        const parsed = JSON.parse(jsonStr);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        console.error("[OpenAIService] JSON parse failed:", text.slice(0, 200));
        return [];
      }
    } catch (e: any) {
      throw new Error(`LLM extraction failed: ${e.message}`);
    }
  }
}
