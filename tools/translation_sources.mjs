// Prints SQL that adds the fixed verse-text pieces from app.js to
// translation_sources (verse meanings are seeded by the migration).
// Run after changing CHAPTER_LENS, DEEP_RULES, APPLY_TODAY or REFLECTIONS:
//   node tools/translation_sources.mjs > pieces.sql   (then run it in Supabase)
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const start = src.indexOf('    const CHAPTER_LENS='), end = src.indexOf('    function deepParts(');
const c = {};
vm.runInNewContext(src.slice(start, end) + ';this.p={CHAPTER_LENS,CHAPTER_LENS_DEFAULT,DEEP_RULES,DEEP_FALLBACK,DEEP_LABEL,APPLY_TODAY,REFLECTIONS,TAB_REFLECTION};', c);
const p = c.p;
const pieces = [
  ...Object.values(p.CHAPTER_LENS), p.CHAPTER_LENS_DEFAULT,
  ...p.DEEP_RULES.map(r => r[1]), p.DEEP_FALLBACK, p.DEEP_LABEL,
  ...Object.values(p.APPLY_TODAY), ...Object.values(p.REFLECTIONS), ...Object.values(p.TAB_REFLECTION),
  'Meaning unavailable.',
];
const q = s => "'" + s.replace(/'/g, "''") + "'";
const rows = [...new Set(pieces)].map(s => `(${q(crypto.createHash('sha256').update(s, 'utf8').digest('hex'))}, ${q(s)}, 'piece', 10)`);
console.log(`insert into public.translation_sources (source_hash, source, kind, priority) values\n${rows.join(',\n')}\non conflict (source_hash) do nothing;`);
console.error(rows.length + ' pieces');
