export type Chapter = {
  id: number;
  name_sanskrit: string;
  name_english: string;
  name_hindi: string | null;
  summary_english: string | null;
  summary_hindi: string | null;
  verse_count: number;
};

export type Verse = {
  id: number;
  chapter_id: number;
  verse_number: number;
  sanskrit: string;
  transliteration: string | null;
  translation_english: string | null;
  translation_hindi: string | null;
  simple_explanation_english: string | null;
  simple_explanation_hindi: string | null;
  practical_takeaway_english: string | null;
  practical_takeaway_hindi: string | null;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: string[];
};
