// Scoring dimensions. 'ai' dimensions are judged by the scoring model from the transcript;
// 'measured' ones come from local audio measurements (pauses, pace, fillers, speaking time).
export type Dimension = { key: string; label: string; weight: number; source: 'ai' | 'measured' };

export const DEFAULT_DIMENSIONS: Dimension[] = [
  { key: 'content', label: 'Content quality', weight: 25, source: 'ai' },
  { key: 'customer_handling', label: 'Customer handling', weight: 20, source: 'ai' },
  { key: 'persuasion', label: 'Persuasion', weight: 20, source: 'ai' },
  { key: 'motivation', label: 'Motivation', weight: 15, source: 'ai' },
  { key: 'confidence', label: 'Confidence (pauses, speaking time)', weight: 10, source: 'measured' },
  { key: 'fluency', label: 'Fluency (pace, fillers)', weight: 10, source: 'measured' },
];
export const DEFAULT_CUTOFF = 60;
