# 🤖 AI News Daily

Daglig AI-nyhetssammanställning som postar till Discord kl 20:00 varje kväll.

## Vad det gör

Hämtar RSS-flöden från AI-källor, filtrerar för:
- 🖥️ **Lokal AI** (edge, on-device, ollama, llamafile)
- 🎵 **Musik-AI** (TTS, music generation, MIDI)
- 🎨 **3D-AI** (mesh generation, Gaussian splatting)
- 🧊 **Blender-integrationer** (plugins, bpy)
- 🎮 **Unreal Engine-integrationer** (ue5, metahuman)

Skickar sammanställningen till din Discord-kanal via webhook.

## Snabbstart

### 1. Skapa Discord-webhook

1. Öppna Discord-servern
2. Gå till önskad kanal → kugghjulet → Integrationer → Webhooks
3. Klicka "New Webhook"
4. Kopiera Webhook URL

### 2. Konfigurera

```bash
cp .env.example .env
nano .env  # Klistra in din webhook-URL
```

### 3. Testa

```bash
node news-bot.js
```

Du bör se ett meddelande i Discord-kanalen inom några sekunder.

### 4. Schemalägg med cron

```bash
crontab -e
```

Lägg till denna rad (kör kl 20:00 varje dag):

```
0 20 * * * cd /home/oris/moltron/projects/ai-news-bot && /usr/bin/node news-bot.js >> logs/cron.log 2>&1
```

## Filer

- `news-bot.js` - Huvudscript
- `.env` - Discord webhook URL (gitignored)
- `.env.example` - Mall
- `logs/` - Cron-loggar (gitignored)
- `docs/` - Dokumentation

## Loggning

Cron-jobbet loggar till `logs/cron.log`. Visa senaste med:
```bash
tail -f logs/cron.log
```
