import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from './src/lib/supabase';
import type { Chapter, ChatMessage, Verse } from './src/types';

type Screen =
  | { name: 'home' }
  | { name: 'chapter'; chapter: Chapter }
  | { name: 'verse'; chapter: Chapter; verse: Verse }
  | { name: 'chat' };

function AppShell() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  return (
    <LinearGradient colors={['#08110C', '#102317', '#1B2D1F']} style={styles.flex}>
      <SafeAreaView style={styles.flex}>
        {screen.name === 'home' && <Home onOpenChapter={(chapter) => setScreen({ name: 'chapter', chapter })} onOpenChat={() => setScreen({ name: 'chat' })} />}
        {screen.name === 'chapter' && <ChapterScreen chapter={screen.chapter} onBack={() => setScreen({ name: 'home' })} onOpenVerse={(verse) => setScreen({ name: 'verse', chapter: screen.chapter, verse })} />}
        {screen.name === 'verse' && <VerseScreen chapter={screen.chapter} verse={screen.verse} onBack={() => setScreen({ name: 'chapter', chapter: screen.chapter })} />}
        {screen.name === 'chat' && <ChatScreen onBack={() => setScreen({ name: 'home' })} />}
      </SafeAreaView>
      <StatusBar style="light" />
    </LinearGradient>
  );
}

function Home({ onOpenChapter, onOpenChat }: { onOpenChapter: (chapter: Chapter) => void; onOpenChat: () => void }) {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('gita_chapters').select('*').order('id').then(({ data }) => {
      setChapters((data ?? []) as Chapter[]);
      setLoading(false);
    });
  }, []);

  return (
    <View style={styles.flex}>
      <View style={styles.hero}>
        <Text style={styles.kicker}>श्रीमद्भगवद्गीता</Text>
        <Text style={styles.title}>Gita with Krishna</Text>
        <Text style={styles.subtitle}>Read the Gita. Reflect on it. Ask questions grounded in its verses.</Text>
        <Pressable style={styles.primaryButton} onPress={onOpenChat}><Text style={styles.primaryButtonText}>Ask Krishna</Text></Pressable>
      </View>
      <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>18 Chapters</Text><Text style={styles.sectionMeta}>Bhagavad Gita</Text></View>
      {loading ? <ActivityIndicator style={{ marginTop: 40 }} /> : (
        <FlatList contentContainerStyle={styles.listContent} data={chapters} keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <Pressable style={styles.card} onPress={() => onOpenChapter(item)}>
              <View style={styles.chapterNumber}><Text style={styles.chapterNumberText}>{item.id}</Text></View>
              <View style={styles.cardTextWrap}>
                <Text style={styles.cardTitle}>{item.name_english}</Text>
                <Text style={styles.cardSanskrit}>{item.name_sanskrit}</Text>
                <Text style={styles.cardMeta}>{item.verse_count} verses</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return <View style={styles.header}><Pressable onPress={onBack}><Text style={styles.back}>‹</Text></Pressable><Text numberOfLines={1} style={styles.headerTitle}>{title}</Text><View style={{ width: 32 }} /></View>;
}

function ChapterScreen({ chapter, onBack, onOpenVerse }: { chapter: Chapter; onBack: () => void; onOpenVerse: (verse: Verse) => void }) {
  const [verses, setVerses] = useState<Verse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('gita_verses').select('*').eq('chapter_id', chapter.id).order('verse_number').then(({ data }) => {
      setVerses((data ?? []) as Verse[]);
      setLoading(false);
    });
  }, [chapter.id]);

  return (
    <View style={styles.flex}>
      <Header title={chapter.name_english} onBack={onBack} />
      <View style={styles.chapterHero}>
        <Text style={styles.chapterHeroNum}>Chapter {chapter.id}</Text>
        <Text style={styles.chapterHeroTitle}>{chapter.name_sanskrit}</Text>
        <Text style={styles.cardMeta}>{chapter.verse_count} verses</Text>
      </View>
      {loading ? <ActivityIndicator style={{ marginTop: 40 }} /> : verses.length === 0 ? (
        <View style={styles.emptyState}><Text style={styles.emptyTitle}>Verses are being added</Text><Text style={styles.emptyBody}>The backend and reader are live. The complete verse dataset will populate this chapter next.</Text></View>
      ) : (
        <FlatList contentContainerStyle={styles.listContent} data={verses} keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <Pressable style={styles.verseRow} onPress={() => onOpenVerse(item)}>
              <Text style={styles.verseLabel}>{chapter.id}.{item.verse_number}</Text>
              <Text numberOfLines={2} style={styles.versePreview}>{item.sanskrit}</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

function VerseScreen({ chapter, verse, onBack }: { chapter: Chapter; verse: Verse; onBack: () => void }) {
  const [language, setLanguage] = useState<'english' | 'hindi'>('english');
  const translation = language === 'english' ? verse.translation_english : verse.translation_hindi;
  const explanation = language === 'english' ? verse.simple_explanation_english : verse.simple_explanation_hindi;
  const takeaway = language === 'english' ? verse.practical_takeaway_english : verse.practical_takeaway_hindi;

  return (
    <View style={styles.flex}>
      <Header title={'Chapter ' + chapter.id + ' · Verse ' + verse.verse_number} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.reader}>
        <View style={styles.pillRow}>
          <Pressable style={[styles.pill, language === 'english' && styles.pillActive]} onPress={() => setLanguage('english')}><Text style={styles.pillText}>English</Text></Pressable>
          <Pressable style={[styles.pill, language === 'hindi' && styles.pillActive]} onPress={() => setLanguage('hindi')}><Text style={styles.pillText}>हिन्दी</Text></Pressable>
        </View>
        <Text style={styles.readerRef}>{chapter.id}.{verse.verse_number}</Text>
        <Text style={styles.sanskritVerse}>{verse.sanskrit}</Text>
        {!!verse.transliteration && <Text style={styles.transliteration}>{verse.transliteration}</Text>}
        <InfoBlock title="Meaning" body={translation} />
        <InfoBlock title="Simple explanation" body={explanation} />
        <InfoBlock title="Take it into your life" body={takeaway} />
      </ScrollView>
    </View>
  );
}

function InfoBlock({ title, body }: { title: string; body: string | null }) {
  if (!body) return null;
  return <View style={styles.infoBlock}><Text style={styles.infoTitle}>{title}</Text><Text style={styles.infoBody}>{body}</Text></View>;
}

function ChatScreen({ onBack }: { onBack: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([{ id: 'welcome', role: 'assistant', content: 'Namaste. Ask about duty, fear, attachment, purpose, relationships, discipline, or anything you want to reflect on through the Bhagavad Gita.' }]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  async function send() {
    const question = input.trim();
    if (!question || sending) return;
    setInput('');
    setMessages((prev) => [...prev, { id: String(Date.now()), role: 'user', content: question }]);
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('ask-krishna', { body: { question } });
      if (error) throw error;
      setMessages((prev) => [...prev, { id: String(Date.now() + 1), role: 'assistant', content: data?.answer ?? 'The guide is not configured yet.', citations: data?.citations ?? [] }]);
    } catch {
      setMessages((prev) => [...prev, { id: String(Date.now() + 1), role: 'assistant', content: 'The Krishna guide backend is not enabled yet. Reading works now; AI chat activates once the model secret is configured.' }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={styles.flex}>
      <Header title="Ask Krishna" onBack={onBack} />
      <FlatList contentContainerStyle={styles.chatList} data={messages} keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={[styles.bubble, item.role === 'user' ? styles.userBubble : styles.assistantBubble]}>
            <Text style={styles.bubbleText}>{item.content}</Text>
            {!!item.citations?.length && <Text style={styles.citation}>{item.citations.join(' · ')}</Text>}
          </View>
        )}
      />
      <View style={styles.composer}>
        <TextInput value={input} onChangeText={setInput} placeholder="What is troubling your mind?" placeholderTextColor="#8CA092" style={styles.input} multiline />
        <Pressable style={styles.sendButton} onPress={send}><Text style={styles.sendButtonText}>{sending ? '…' : 'Send'}</Text></Pressable>
      </View>
    </View>
  );
}

export default function App() { return <SafeAreaProvider><AppShell /></SafeAreaProvider>; }

const styles = StyleSheet.create({
  flex:{flex:1}, hero:{paddingHorizontal:22,paddingTop:28,paddingBottom:20}, kicker:{color:'#D7B56D',fontSize:18,marginBottom:10,fontWeight:'700'},
  title:{color:'#F5F0E6',fontSize:36,fontWeight:'800',letterSpacing:-1}, subtitle:{color:'#B9C6BC',fontSize:16,lineHeight:24,marginTop:10},
  primaryButton:{marginTop:20,alignSelf:'flex-start',backgroundColor:'#D7B56D',paddingHorizontal:18,paddingVertical:12,borderRadius:999}, primaryButtonText:{color:'#142017',fontWeight:'800'},
  sectionHeader:{paddingHorizontal:22,paddingVertical:12,flexDirection:'row',alignItems:'center',justifyContent:'space-between'}, sectionTitle:{color:'#F5F0E6',fontWeight:'800',fontSize:21}, sectionMeta:{color:'#829487'},
  listContent:{paddingHorizontal:16,paddingBottom:32}, card:{backgroundColor:'rgba(255,255,255,0.055)',borderWidth:1,borderColor:'rgba(255,255,255,0.07)',borderRadius:18,padding:16,marginVertical:6,flexDirection:'row',alignItems:'center'},
  chapterNumber:{width:42,height:42,borderRadius:21,backgroundColor:'#233829',alignItems:'center',justifyContent:'center'}, chapterNumberText:{color:'#D7B56D',fontWeight:'800'},
  cardTextWrap:{flex:1,paddingHorizontal:14}, cardTitle:{color:'#F2EEE5',fontWeight:'700',fontSize:16}, cardSanskrit:{color:'#AFC0B3',marginTop:3,fontSize:14}, cardMeta:{color:'#829487',marginTop:5,fontSize:12}, chevron:{color:'#D7B56D',fontSize:28},
  header:{height:58,paddingHorizontal:16,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:1,borderColor:'rgba(255,255,255,.06)'}, back:{color:'#F5F0E6',fontSize:34,width:32}, headerTitle:{color:'#F5F0E6',fontSize:16,fontWeight:'700',maxWidth:'75%'},
  chapterHero:{paddingHorizontal:22,paddingVertical:24}, chapterHeroNum:{color:'#D7B56D',fontWeight:'800',fontSize:12}, chapterHeroTitle:{color:'#F5F0E6',fontSize:27,fontWeight:'800',marginTop:8},
  emptyState:{margin:22,padding:22,borderRadius:18,backgroundColor:'rgba(255,255,255,.05)'}, emptyTitle:{color:'#F5F0E6',fontSize:18,fontWeight:'800'}, emptyBody:{color:'#AAB9AE',marginTop:8,lineHeight:21},
  verseRow:{borderBottomWidth:1,borderColor:'rgba(255,255,255,.06)',paddingVertical:16,flexDirection:'row',gap:16}, verseLabel:{color:'#D7B56D',fontWeight:'800',width:46}, versePreview:{color:'#DDE6DF',flex:1,lineHeight:22},
  reader:{padding:22,paddingBottom:60}, pillRow:{flexDirection:'row',gap:8}, pill:{paddingHorizontal:12,paddingVertical:8,borderRadius:999,borderWidth:1,borderColor:'rgba(255,255,255,.12)'}, pillActive:{backgroundColor:'#263D2B'}, pillText:{color:'#E8EEE9',fontSize:12,fontWeight:'700'},
  readerRef:{color:'#D7B56D',fontWeight:'800',marginTop:34,marginBottom:12,textAlign:'center'}, sanskritVerse:{color:'#FBF5E8',textAlign:'center',fontSize:24,lineHeight:38,fontWeight:'700'},
  transliteration:{color:'#AFC0B3',textAlign:'center',fontSize:14,lineHeight:22,marginTop:16,fontStyle:'italic'}, infoBlock:{marginTop:30,paddingTop:22,borderTopWidth:1,borderColor:'rgba(255,255,255,.08)'}, infoTitle:{color:'#D7B56D',fontWeight:'800',fontSize:12,marginBottom:9}, infoBody:{color:'#E1E8E2',fontSize:17,lineHeight:28},
  chatList:{padding:16}, bubble:{maxWidth:'87%',borderRadius:18,padding:14,marginVertical:5}, assistantBubble:{alignSelf:'flex-start',backgroundColor:'rgba(255,255,255,.07)'}, userBubble:{alignSelf:'flex-end',backgroundColor:'#28402E'}, bubbleText:{color:'#EDF2EE',lineHeight:21}, citation:{color:'#D7B56D',fontSize:12,marginTop:8,fontWeight:'700'},
  composer:{padding:12,borderTopWidth:1,borderColor:'rgba(255,255,255,.08)',flexDirection:'row',gap:8,alignItems:'flex-end'}, input:{flex:1,minHeight:44,maxHeight:110,borderWidth:1,borderColor:'rgba(255,255,255,.12)',borderRadius:16,color:'#F5F0E6',paddingHorizontal:14,paddingVertical:11}, sendButton:{backgroundColor:'#D7B56D',borderRadius:14,paddingHorizontal:16,paddingVertical:13}, sendButtonText:{color:'#132016',fontWeight:'800'}
});