export interface VehicleSpec {
  component: string;
  spec_type: string;
  value: string;
  unit: string;
  part_number?: string;
  condition?: string;
  source_page?: number;
  confidence: number;
  source_context?: string;
}

export interface ProcessingStep {
  id: string;
  label: string;
  status: 'idle' | 'loading' | 'completed' | 'error';
  description: string;
}

export interface Chunk {
  id: string;
  text: string;
  section?: string;
  page: number;
  embedding?: number[];
  isSpecPriority?: boolean;
}
