# Kurulum ve Taşıma Notları

Bu repo, daha önce iki ayrı proje olan `tiktalk-admin` ve `seedance-automation` klasörlerini tek monorepo altında birleştirdi.

## Monorepo Yapısı

```
tiktalk-pipeline/
├── seedance-automation/   # Playwright/Electron Dreamina otomasyonu
└── tiktalk-admin/         # Next.js admin panel (bu klasör)
```

İki klasör kardeş olarak duruyor. `tiktalk-admin` API route'ları seedance'e `path.join(process.cwd(), "..", "seedance-automation")` ile bakar — yani terminalden `npm run dev` her zaman `tiktalk-admin/` içinden çalıştırılmalı.

## Taşınma Sonrası Eksikler

Monorepo'ya taşınırken kaynak dosyalar kopyalandı, ancak `seedance-automation/` klasörünün **runtime verileri eski konumda kaldı**:

**Eski konum:** `C:\Users\rfatk\OneDrive\Masaüstü\seedance-automation\`

Hala orada olan ve taşınması gereken klasörler:

| Klasör | Boyut | Ne İşe Yarar |
|--------|-------|--------------|
| `browser-data/` | ~416 MB | Dreamina (CapCut) giriş profili. Taşımazsan yeniden giriş yapman gerekir. |
| `node_modules/` | ~411 MB | Bağımlılıklar. Taşımak yerine yeni konumda `npm install` da çalışır. |
| `downloads/` | ~245 MB | İndirilen video dosyaları. Pipeline için bunların taşınması önemli. |
| `logs/` | ~644 KB | Runner log'ları. İsteğe bağlı. |

### Taşıma Komutları

Elektron/browser tamamen kapalıyken PowerShell veya Git Bash'te:

```bash
# Browser profile + downloads + logs taşı
mv "C:/Users/rfatk/OneDrive/Masaüstü/seedance-automation/browser-data" "C:/Users/rfatk/projects/tiktalk-pipeline/seedance-automation/"
mv "C:/Users/rfatk/OneDrive/Masaüstü/seedance-automation/downloads" "C:/Users/rfatk/projects/tiktalk-pipeline/seedance-automation/"
mv "C:/Users/rfatk/OneDrive/Masaüstü/seedance-automation/logs" "C:/Users/rfatk/projects/tiktalk-pipeline/seedance-automation/"

# node_modules için ya taşı ya da yeniden kur (tercih: yeniden kur)
cd "C:/Users/rfatk/projects/tiktalk-pipeline/seedance-automation" && npm install
```

Taşıma bitince eski `OneDrive/Masaüstü/seedance-automation/` klasörü silinebilir.

## Sıfırdan Kurulum (yeni bir makinede)

```bash
git clone git@github.com:rfatkocak/tiktalk-pipeline.git
cd tiktalk-pipeline

# tiktalk-admin
cd tiktalk-admin
npm install
cp .env.local.example .env.local  # .env.local değerleri manuel girilmeli
npm run dev

# seedance-automation (ayrı terminal)
cd ../seedance-automation
npm install
# İlk çalıştırmada Dreamina'ya login olmak gerekir (browser-data oluşur)
```

### `.env.local` içinde olması gerekenler (tiktalk-admin)

```env
DATABASE_URL=postgresql://...
BUNNY_STORAGE_ZONE=...
BUNNY_STORAGE_KEY=...
BUNNY_STORAGE_HOST=storage.bunnycdn.com
GEMINI_API_KEY=...
OPENAI_API_KEY=...
```

`.env.local` `.gitignore`'da, repo'ya pushlanmaz.

## Pipeline Akışı

1. **Prompt** — UI'dan kanal/level/vibe seç → Gemini TP seçer ve seedance prompt yazar → `pool_items` tablosuna kaydedilir
2. **Video** — "Start Seedance" butonu → `/api/seedance` → `seedance-runner.js` detached process → Dreamina'da video üretilir → `downloads/` altına MP4
3. **Transkript** — `/api/whisper` → OpenAI Whisper → transkript DB'ye
4. **İçerik** — `/api/content` → Gemini → quiz, alıştırma, 12 dil çeviri
5. **CDN** — `/api/upload-cdn` → Bunny CDN'e yükle → URL + thumbnail
6. **DB** — Tüm veriler PostgreSQL'de (Hetzner 91.98.46.133:35432)
