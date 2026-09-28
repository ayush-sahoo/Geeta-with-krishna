-- Six verses had the placeholder "Shri Purohit Swami did not comment on this
-- sloka" as their meaning. Replace it with faithful renderings in the same
-- style as the rest of the translation (12.3 and 12.18 continue into the next
-- verse, as they do in the Sanskrit), and swap the placeholder's stored
-- translations for the new meanings (translation-worker fills them in).

update public.gita_verses set translation_english = v.meaning
from (values
  (4, 33, '4.33 The sacrifice of wisdom is nobler than any sacrifice of material things, O Scorcher of Foes; for all action, without exception, culminates in wisdom.'),
  (6, 38, '6.38 Fallen from both worldly and spiritual life, does he not perish like a broken cloud, O Mighty-armed, with no foothold, bewildered on the path that leads to the Eternal?'),
  (8, 1, '8.1 Arjuna asked: O Supreme Spirit! What is the Eternal? What is the Self? What is action? What is it that is called the material world, and what is it that is called the divine?'),
  (10, 15, '10.15 Thou alone knowest Thyself by Thyself, O Supreme Spirit, Source and Lord of all beings, God of gods, Ruler of the universe!'),
  (12, 3, '12.3 But those who worship the Imperishable, the Indefinable, the Unmanifest, the Omnipresent, the Unthinkable, the Unchanging, the Immovable and the Eternal,'),
  (12, 18, '12.18 He who is the same to friend and foe, the same in honour and dishonour, who is balanced in heat and cold, in pleasure and pain, and who is free from attachment,')
) as v(chapter_id, verse_number, meaning)
where gita_verses.chapter_id = v.chapter_id and gita_verses.verse_number = v.verse_number
  and gita_verses.translation_english ilike '%did not comment on this sloka%';

-- Same cleanup as app.js cleanTranslation: drop the "4.33 " prefix, trim.
insert into public.translation_sources (source_hash, source, kind, priority)
select encode(sha256(convert_to(src, 'UTF8')), 'hex'), src, 'meaning', 5
from (
  select regexp_replace(regexp_replace(translation_english, '^\d+\.\d+\.?\s*', ''), '^\s+|\s+$', '', 'g') as src
  from public.gita_verses
  where (chapter_id, verse_number) in ((4, 33), (6, 38), (8, 1), (10, 15), (12, 3), (12, 18))
) m
on conflict (source_hash) do nothing;

delete from public.text_translations
where source_hash = encode(sha256(convert_to('Shri Purohit Swami did not comment on this sloka', 'UTF8')), 'hex');
delete from public.translation_sources
where source = 'Shri Purohit Swami did not comment on this sloka';
