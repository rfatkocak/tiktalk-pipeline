---                                                                                                                
  Prompt & İçerik Sorunları                                                                                                                                                                                                               
  1. Quiz'ler sadece İngilizce — Soru ve seçenekler hep İngilizce. Beginner seviyesinde bir Türk kullanıcı "What does   the speaker imply by..." sorusunu anlamayabilir. Quiz sorusu ve seçenekleri de locale'e göre çevrilmeli, en         azından beginner seviyesinde.                                                                                      
                                                                                                                     
  2. Speaking prompt "Repeat" metni bağlamsız — "Repeat: What was that?" diyor ama kullanıcı neyi neden tekrarlıyor
  bilmiyor. Hangi sahnede söylendiği, tonlama ipucu, telaffuz notu yok. Bir dil uygulaması için "tekrarla" yetmez.

  3. Produce prompt'ta değerlendirme kriterleri yok — context_hint var ama LLM'in kullanıcı cevabını nasıl
  puanlayacağına dair grading rubric yok. Doğru/yanlış mı, kısmi puan var mı, hangi gramer yapısını kullanması       
  bekleniyor?

  4. Info section'larda video bağlamı kopuk — Genel gramer açıklaması yapılıyor ama "videodaki şu sahnede şu yüzden  
  kullanıldı" bağlantısı kurulmuyor. Öğrenci "bu kural ne alaka?" diyebilir.

  5. Subtitle çevirilerinde bağlamsal kalite kontrolü yok — Prompt'ta "natural, not Google Translate" deniyor ama 12 
  dilde kalite kontrolü sıfır. Özellikle Japonca, Arapça, Korece gibi yapısal olarak çok farklı dillerde Gemini'nin  
  çeviri kalitesi tartışmalı.

  6. Videoda kaç konuşmacı var bilgisi kullanılmıyor — Whisper speaker dönüyor ama bu bilgi quiz veya info section'a 
  yansımıyor. "Who said X?" tarzı sorular oluşturulamıyor.

  7. Hashtag/description gereksiz — 15 saniyelik eğitim videosu için sosyal medya description ve hashtag üretiliyor. 
  Bu bir TikTok değil, bir dil uygulaması. Description alanı uygulamada nasıl kullanılacak?

  8. Kültürel section her zaman 1 tane — Prompt "1 cultural or contextual_translation" diyor. Bazı videolarda        
  kültürel bağlam çok zengin olabilir (restoranda sipariş verme, iş görüşmesi), bazılarında hiç olmayabilir (korku   
  sahnesi). Sabit sayı yerine "gerekirse" olmalı.

  9. Keyword'ler nasıl kullanılacak belirsiz — 5-10 keyword üretiliyor ama uygulamada search dışında ne işe yarıyor? 
  Öğrenci vocabulary listesi mi görecek? Kelime kartı mı? Şu an sadece DB'de duruyor.

  10. Video seviyesi ile quiz seviyesi arasındaki tutarlılık test edilmiyor — Prompt'ta "match the level" deniyor ama
   üretilen içeriğin gerçekten o seviyeye uygun olup olmadığını doğrulayan bir mekanizma yok.

  ---
  Eksik İçerik Tipleri

  11. Vocabulary highlight yok — Videodaki anahtar kelimeler için tanım, örnek cümle, pronunciation (IPA)
  üretilmiyor. Dil uygulamasının olmazsa olmazı.

  12. Dialogue breakdown yok — "Kim kime ne diyor, neden" analizi yok. Öğrenci sahneyi anlasa bile diyaloğun
  pragmatik yapısını (soru-cevap, rica, reddetme) kavrayamıyor.

  13. "Common mistakes" section'ı yok — Öğrencilerin bu yapıları kullanırken en çok yaptığı hatalar belirtilmiyor.   
  Dil öğretiminde çok değerli.

  ---
  Hangilerini öncelikli görüyorsun? İstersen hepsini prompt'a ekleyebilirim, ya da seçtiklerini yapalım.

  Anladım, TikTok-benzeri feed ama her video öğretiyor. O zaman bazı eleştirilerimi geri çekiyorum                   
  (hashtag/description mantıklı, keyword'ler discover/search için gerekli). Bu vizyonla bakınca:                     
                                                                                                                     
  ---                                                                                                                
  Engagement & Retention                  
                                                                                                                       1. Videonun "hook"u yok — Sosyal medyada ilk 1-2 saniye her şey. Ama prompt'ta "ilk sahne dikkat çekici olsun" gibi   bir yönlendirme yok. Seedance prompt'unda buna dikkat edilmeli.                                                   
                                                                                                                     
  2. Video bitişinde CTA yok — "Bu yapıyı bilmiyorsan kaydır ve öğren" gibi bir mekanizma yok. Video bitiyor,
  kullanıcı quiz'e geçiyor mu, scroll'a devam mı ediyor? Bu geçiş tasarlanmalı ama içerik tarafında videonun bunu
  desteklemesi lazım.

  3. Difficulty progression yok — Kullanıcı beginner'dan intermediate'e ne zaman geçiyor? Şu an videolar bağımsız.   
  Bir kullanıcının hangi TP'leri "öğrendiğini" takip eden bir sistem yok. Collection'lar bunu çözebilir ama henüz    
  kullanılmıyor.

  ---
  Sosyal Medya DNA'sı

  4. Video personality/karakter sürekliliği yok — TikTok'ta insanlar creator'ları takip eder. Channel var ama        
  channel'ın bir "karakteri", recurring bir figürü, tutarlı bir dünyası yok. Prompt'ta "bu channel'ın önceki
  videoları şunlardı, tutarlı ol" gibi bir context verilmiyor.

  5. Trending/seasonal içerik yok — "Tatil sezonunda restoran İngilizcesi" gibi zamana bağlı içerik üretme
  mekanizması yok. Vibes bunu kısmen çözüyor ama takvimle bağlantılı değil.

  6. Shareability düşünülmemiş — Kullanıcı videoyu paylaşınca ne görünecek? OG meta, thumbnail kalitesi, video       
  preview. Thumbnail şu an ffmpeg ile 1. saniyeden alınıyor, bu genelde siyah veya anlamsız bir kare olur.

  ---
  Öğrenme Deneyimi

  7. Spaced repetition bağlantısı yok — Kullanıcı bir TP'yi gördü ama 3 gün sonra tekrar karşısına çıkmalı. Feed     
  algoritması bunu bilemez çünkü user-level TP tracking yok.

  8. Micro-feedback döngüsü eksik — Quiz çözdü, doğru/yanlış. Ama "neden yanlış yaptın, şu videoya geri dön" gibi bir
   bağlantı yok. Quiz sonucu bir yere kaydedilmiyor.

  9. Passive vs active learning dengesi yok — Video izlemek pasif. Quiz ve speaking prompt aktif. Ama oran ne olmalı?
   Şu an her videoda zorla 3 quiz var. Sosyal medya deneyiminde kullanıcı quiz'i skip edebilmeli mi? "Öğrenmek       
  istiyorsan aç" modeli daha doğal olabilir.

  10. Kullanıcının ana dili bilinmiyor prompt'ta — Gemini'ye 12 dilde çeviri yaptırıyoruz ama kullanıcının hangisini 
  konuştuğunu bilmiyoruz. Uygulamada kullanıcı tr seçtiyse, quiz açıklamaları direkt Türkçe gösterilecek. Ama        
  prompt'ta "bu kullanıcı Türk, explanations'ı ona göre yaz" denmiyor — tüm diller eşit derinlikte üretiliyor.       

  ---
  İçerik Kalitesi

  11. Video script ile gerçek ses uyuşmazlığı sorunu — Match score 0.5 threshold çok düşük. Yarısı yanlış bir        
  transcript üzerine quiz/subtitle üretmek tehlikeli. 0.7-0.8 daha güvenli olur.

  12. Aynı TP farklı videolarda farklı açıklanıyor olabilir — TP "Present Continuous" 5 farklı videoda 5 farklı info 
  section üretiyor. Bunlar birbiriyle çelişebilir. Bir TP'nin "canonical" açıklaması olmalı, videoya özgü olan sadece
   bağlam olmalı.

  13. 15 saniye çok kısa olabilir — Bazı TP'ler (conditionals, reported speech) 15 saniyeye sığmaz. Prompt'ta TP     
  complexity ile video süresi arasında bir uyarı/kontrol yok. Advanced TP'ler için 30 saniye gerekebilir.

  ---
  Bunların çoğu ürün roadmap konusu, hepsini şu an koda dökmek gerekmez. Ama prompt'a şu an eklenebilecek düşük      
  eforlu olanlar var — thumbnail kalitesi, match threshold, channel consistency gibi. Hangilerine not almak istersin,
   hangilerini şimdi yapalım?


 Bunu sistematik bakayım. 3 kategoride eleştiri var: eksikler, fazlalıklar, tek çağrı vs parçalama.                 
                                                                                                                     
  ---                                                                                                                
  1️ /api/generate — Ekshkler                 )                                                                                                                                                                                            
  🚨 Ciddi: level gönderilmiyor!                                                                                     
                                                                                                                       Pool UI'da kullanıcı level seçiyor ama /api/generate prompt'una level girmiyor. Gemini TP'leri seviye              
  farketmeksizin seçiyor. Sonuç: beginner pool item'ına advanced TP gelebilir.                                       
                                                                                                                     
  Fix: level'i request body'ye ekle, prompt'a TARGET LEVEL: ${level} satırı koy, "prefer TPs matching this level"  
  talimatı ver.

  Eksik context

  - Kanal description: channels tablosunda var ama verilmiyor. Kanalın tonunu, hedef kitlesini belirtirdi.
  - Kanalda daha önce üretilen seedance prompt'ları: Tekrar önlemek için son 5 prompt özeti verilebilir — "bu        
  senaryolar zaten yapıldı, benzerini yapma".
  - Diyalog uzunluk kısıtı: "15 saniye" deniyor ama kelime sayısı/satır sayısı sınırı yok. Gemini bazen çok uzun     
  diyalog üretiyor → Seedance 15s'ye sığdıramıyor. Öneri: "2 konuşmacı, toplam 25-35 kelime, maks 4 replik".
  - Karakter sayısı kısıtı: "2 karakter" dersen sahne daha nettir.

  Temperature çok yüksek

  temperature: 1.0 → yaratıcılık için ok ama JSON yapısı bozulabilir. 0.8 daha güvenli.

  ---
  2️⃣/api/content — Eksikler

  🚨 Konuşmacı kimlikleri yok

  Whisper Speaker 0, Speaker 1 diyor ama kim kim belli değil. Seedance prompt'ta "barista ve müşteri" geçiyor        
  olabilir ama Gemini eşleştiremiyor. Çeviriler bundan etkileniyor (TR/JP/KR'de kibarlık formu, ES'de tu/usted...).  

  Fix: Gemini'ye önce "speaker mapping" sor: {"Speaker 0": "customer", "Speaker 1": "barista"}. Ya da prompt'a       
  "Seedance prompt'undaki karakter açıklamalarını kullanarak konuşmacıları etiketle" ekle.

  Level uyumu TP seçiminde eksik

  TP listesi level field'ı ile veriliyor ama sadece "her TP'nin kendi level'ı" olarak. Video level'ı ile TP level'ı  
  uyumsuzsa Gemini'yi uyarmıyoruz. "Video beginner, TP advanced" durumunda ne olacak belli değil.

  Kanal tonu/hedef kitle

  description verilmiyor (generate'de de yok). Örn. "gençlere yönelik casual kanal" vs "iş İngilizcesi" çok farklı   
  çeviri/quiz üretmeli.

  Info section sayısı bulanık

  "Her TP için bir grammar section + 1 cultural" diyoruz ama min/max yok. 4 TP varsa 5 section oluyor, 1 TP varsa 2. 
  Tahmin edilebilirlik düşük. Önerim: "exactly N+1 sections where N = TP count" net ifade et.

  Quiz çeşitliliği garantisi

  "3 quiz farklı type olsun" ama 3 TP de grammar ise vocabulary quizi üretmek zorlanıyor. Esnek ifade et: "prefer    
  different types, but prioritize quality".

  Few-shot eksik

  Hiçbir prompt'ta örnek yok. Tek bir "iyi quiz" + "iyi info section" örneği Gemini kalitesini ciddi artırır.        

  ---
  3️⃣Fazlalıklar (verilebilir ama gerekli mi?)

  REASONING (Türkçe notes)

  /api/content'e Türkçe reasoning veriyoruz. Gemini'nin buna ihtiyacı şüpheli — TP seçim mantığı zaten seedance      
  prompt ve transcript'te mevcut. Çıkarsa prompt 500-1000 token küçülür, hız artar.

  full_text + segments

  segments zaten tüm metni içeriyor. full_text çift kaynak. Segments yeter.

  ---
  4️⃣Tek çağrı vs parçalama — BU BÜYÜK KONU

  Şu an: 1 mega çağrı (~65K token out)

  - ✅ Atomik: ya hep ya hiç, transaction ile uyumlu
  - ✅ Tutarlılık: tüm içerik birbiriyle uyumlu
  - ❌ 10 dakika timeout çekebiliyor (bugün yaşadın)
  - ❌ Quality dilution: Gemini 13 locale × 3 quiz × N section juggling yaparken çeviri kalitesi düşüyor
  - ❌ Bir segment patlayınca hepsi çöpe
  - ❌ maxOutputTokens: 65536 model limitinde, response tıkanabilir (finishReason: MAX_TOKENS riski yüksek)

  Önerilen: 3 aşamalı parçalama

  Aşama A — Match check (hızlı, ucuz)
  - Input: seedance prompt + transcript
  - Output: {match, match_score, match_reason}
  - ~2K token, 5-10 saniye
  - Match false → hiç diğerlerini çağırma, %90 kaynak tasarrufu

  Aşama B — English content (tek çağrı)
  - Input: match true, tüm context
  - Output: title, slug, description, keywords, 3 English quiz, English info sections, 3 speaking prompt
  - ~10K token out, 20-40 saniye
  - Yapısal validation burada biter

  Aşama C — Çeviriler (4 paralel çağrı)
  - Input: English content + transcript segments
  - Output: Her çağrı 3 locale çevirir (subtitles + quiz explanations + info section bodies)
  - Grup 1: tr, pt-BR, es
  - Grup 2: ja, ko, id
  - Grup 3: ar, de, fr
  - Grup 4: it, ru, pl
  - Her çağrı ~15K token out, 30-60 saniye
  - Paralel olduğu için toplam süre ≈ en yavaşı
  - Bir locale patlarsa sadece o grup retry edilir

  Kazanımlar

  ┌───────────────────────┬────────────┬───────────────────────┐
  │        Metrik         │ Tek çağrı  │        Parçalı        │
  ├───────────────────────┼────────────┼───────────────────────┤
  │ Toplam süre           │ 3-10 dk    │ 1-2 dk (paralel)      │
  ├───────────────────────┼────────────┼───────────────────────┤
  │ Timeout riski         │ Yüksek     │ Düşük                 │
  ├───────────────────────┼────────────┼───────────────────────┤
  │ Retry maliyeti        │ Tam baştan │ Sadece patlayan parça │
  ├───────────────────────┼────────────┼───────────────────────┤
  │ Çeviri kalitesi       │ Orta       │ Yüksek (odak dar)     │
  ├───────────────────────┼────────────┼───────────────────────┤
  │ MAX_TOKENS riski      │ Var        │ Yok                   │
  ├───────────────────────┼────────────┼───────────────────────┤
  │ Match-false tasarrufu │ Yok        │ %90                   │
  ├───────────────────────┼────────────┼───────────────────────┤
  │ Transaction safety    │ Kolay      │ Orkestratöre bağlı    │
  └───────────────────────┴────────────┴───────────────────────┘

  Kayıplar

  - Daha karmaşık orkestrasyon kodu
  - Transaction tüm parçalar gelince açılmalı (staging tablosu ya da memory'de topla)
  - Tutarlılık riski: quiz İngilizce, çeviri yanlış anlayabilir — ama context verirsen sorun olmaz
  - Cost: toplam ~1.5-2× daha fazla token (prompt tekrar gönderiliyor). Ama Gemini 2.5 Pro input ucuz.

  ---
  5️⃣Başka iyileştirmeler

  JSON Schema mode (Vertex AI destekliyor)

  responseMimeType: "application/json" kullanıyoruz ama responseSchema kullanmıyoruz. Schema verirsen Gemini hiç     
  hatalı JSON üretemez — enum, locale eksikliği, tip hatası baştan önlenir. Validation kodu %80 küçülür.

  System instruction ayrımı

  Şu an tek user mesajı var. Vertex'te systemInstruction parametresi var: "You are a content generator for
  TikTalk..." kısmı oraya gider, daha iyi uyum sağlar.

  Temperature'ı içerik tipine göre

  - Match check: 0.2 (deterministik)
  - Metadata + quizzes: 0.5
  - Info sections + speaking prompts: 0.7
  - Çeviriler: 0.3 (sadakat)

  Şu an hepsi 0.7 → çeviriler gereksiz "creative" oluyor.

  Gemini'ye "düşün" adımı

  gemini-2.5-pro thinking modunu destekliyor. Mega prompt'ta thinkingConfig: { thinkingBudget: 8192 } eklersen önce  
  plan yapar, sonra JSON üretir. Quality artar.

  ---
  📋 Önerilen Eylem Planı (öncelik sırası)

  1. /api/generate'e level gönder — hızlı, kritik bug
  2. responseSchema ekle — validation kodunu yarısına indirir, güvenlik artar
  3. Match check'i ayrı endpoint'e al — ucuz win, match-false case'i çok hızlanır
  4. Çevirileri paralel 4 çağrıya böl — timeout sorunu kalıcı çözülür
  5. Speaker mapping ekle — çeviri kalitesi ciddi artar
  6. Kanal description'ı her iki endpoint'e ekle — kanal kişiliği oluşur
  7. Temperature'ı içerik tipine göre ayarla
  8. Few-shot örnek ekle (en az quiz için 1 örnek)

  Hangisiyle başlayalım? Bence 1 + 3 en hızlı kazançlar. 4 en büyük yapısal iyileştirme ama iş gerektiriyor.
