#!/usr/bin/env node
/**
 * news-bot.js - Daglig AI-nyhetssammanfattning
 *
 * 1. Hämtar RSS från 6 källor
 * 2. AI (MiniMax) skriver redaktionell sammanfattning
 * 3. Genererar HTML-artikel
 * 4. Pushar till GitHub Pages (steffost/ai-news)
 * 5. Skickar HTML-länk till Discord
 *
 * Cron: 0 20 * * *
 */

import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHANNEL_ID = '1524113361476780194';
const GITHUB_REPO = 'steffost/ai-news';
const GITHUB_BRANCH = 'main';

const SOURCES = [
    { name: 'GN Lokal AI', url: 'https://news.google.com/rss/search?q=%22local+AI%22+OR+%22ollama%22+OR+%22llamafile%22+OR+%22on-device+AI%22&hl=en-US&gl=US&ceid=US:en', cat: '🖥️ Lokal AI' },
    { name: 'GN Musik-AI', url: 'https://news.google.com/rss/search?q=%22music+generation%22+OR+%22suno%22+OR+%22udio%22+OR+%22stable+audio%22&hl=en-US&gl=US&ceid=US:en', cat: '🎵 Musik-AI' },
    { name: 'GN 3D-AI', url: 'https://news.google.com/rss/search?q=%22text-to-3d%22+OR+%22gaussian+splatting%22+OR+%22mesh+generation%22&hl=en-US&gl=US&ceid=US:en', cat: '🎨 3D-AI' },
    { name: 'GN Blender', url: 'https://news.google.com/rss/search?q=%22blender%22+AND+%22AI%22&hl=en-US&gl=US&ceid=US:en', cat: '🧊 Blender' },
    { name: 'GN Unreal', url: 'https://news.google.com/rss/search?q=%22unreal+engine%22+AND+%22AI%22+OR+%22ue5%22+OR+%22metahuman%22&hl=en-US&gl=US&ceid=US:en', cat: '🎮 Unreal' },
    { name: 'Hacker News AI', url: 'https://hnrss.org/newest?q=AI+OR+LLM&points=30' }
];

const KEYWORDS = {
    '🖥️ Lokal AI': ['local ai', 'edge ai', 'on-device', 'ollama', 'llamafile', 'llama.cpp', 'gguf', 'local llm', 'phi-', 'mistral', 'qwen'],
    '🎵 Musik-AI': ['music generation', 'ai music', 'tts', 'voice clone', 'suno', 'udio', 'elevenlabs', 'musicgen', 'stable audio'],
    '🎨 3D-AI': ['3d generation', 'text-to-3d', 'image-to-3d', 'gaussian splatting', 'mesh generation', 'triposr', 'shap-e'],
    '🧊 Blender': ['blender', 'bpy', 'blender plugin', 'geometry nodes'],
    '🎮 Unreal': ['unreal engine', 'unrealengine', 'ue5', 'metahuman', 'nanite', 'lumen', 'epic games']
};

function getCredentials() {
    const configPath = '/home/oris/.openclaw/openclaw.json';
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const discordToken = config.channels?.discord?.token;
    let githubToken = null;
    let minimaxKey = null;
    const envPath = '/home/oris/moltron/projects/ombra-prime-assets-v2/.env';
    if (fs.existsSync(envPath)) {
        for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
            if (line.startsWith('GITHUB_TOKEN=')) githubToken = line.split('=', 2)[1].trim();
            if (line.startsWith('MINIMAX_API_KEY=')) minimaxKey = line.split('=', 2)[1].trim();
        }
    }
    return { discordToken, githubToken, minimaxKey };
}

function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https') ? https : http;
        const req = lib.get(url, { headers: { 'User-Agent': 'Oris-AI-News-Bot/1.0' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetchUrl(res.headers.location).then(resolve, reject);
            }
            if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

function extractItems(xml) {
    const items = [];
    const re = /<item[^>]*>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
        const c = m[1];
        const t = c.match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/s);
        let l = c.match(/<link[^>]*>(.*?)<\/link>/);
        const d = c.match(/<pubDate[^>]*>(.*?)<\/pubDate>/);
        const descMatch = c.match(/<description[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/s);
        if (t) {
            let summary = '';
            if (descMatch) {
                summary = descMatch[1]
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/&[a-z]+;/gi, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                if (summary.length > 200) {
                    const cut = summary.substring(0, 200);
                    const lastDot = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
                    summary = lastDot > 50 ? cut.substring(0, lastDot + 1) : cut + '...';
                }
            }
            items.push({
                title: t[1].replace(/<[^>]+>/g, '').trim(),
                link: l ? l[1].trim() : '',
                date: d ? new Date(d[1].trim()) : new Date(0),
                summary
            });
        }
    }
    return items;
}

function categorize(title, sourceCat) {
    if (sourceCat) return sourceCat;
    const lower = title.toLowerCase();
    for (const [cat, kws] of Object.entries(KEYWORDS)) {
        if (kws.some(kw => lower.includes(kw))) return cat;
    }
    return null;
}

function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function generateEditorialSummary(apiKey, categorized, date) {
    // Bygg en sammanfattning av vad som händer
    const sections = [];
    for (const [cat, items] of Object.entries(categorized)) {
        if (items.length === 0) continue;
        const topItems = items.slice(0, 5).map(i => `- ${i.title}${i.summary ? ': ' + i.summary : ''}`).join('\n');
        sections.push(`${cat} (${items.length} nyheter):\n${topItems}`);
    }

    if (sections.length === 0) {
        return {
            headline: '🤷 Lugnt på AI-fronten',
            intro: 'Inga särskilt stora nyheter idag. Imorgon är en ny dag.',
            sections: []
        };
    }

    const prompt = `Du är redaktör för en daglig AI-nyhetssammanfattning. Skriv EN kort, redaktionell artikel på svenska som sammanfattar dagens viktigaste AI-nyheter för en tekniskt kunnig läsare (Mr. Splendid, bygger Ombra Prime-universumet).

DATUM: ${date.toLocaleDateString('sv-SE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}

NYHETER:
${sections.join('\n\n')}

INSTRUKTIONER:
1. Skriv en kort, katchig HEADLINE (1 rad, max 80 tecken) som fångar dagens tema
2. Skriv en INTRO (2-3 meningar) som sammanfattar huvudpoängen
3. För VARJE kategori med nyheter, skriv en kort ANALYS (2-4 meningar) som sätter nyheterna i kontext och förklarar varför de är viktiga. Skriv i en redaktionell ton - inte bara "finns nyheter om X" utan "X visar att branschen rör sig mot Y"
4. Var kritisk och analytisk, inte bara beskrivande
5. Nämn INTE specifika URLs - bara resonera kring trenderna

FORMAT (VIKTIGT - returnera ENDAST valid JSON):
{
  "headline": "...",
  "intro": "...",
  "sections": [
    {"category": "🖥️ Lokal AI", "analysis": "..."}
  ]
}`;

    try {
        const response = await fetch('https://api.minimax.io/anthropic/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-3-5-sonnet-20241022',
                max_tokens: 2000,
                messages: [{ role: 'user', content: prompt }]
            })
        });

        if (!response.ok) {
            throw new Error(`API ${response.status}`);
        }
        const data = await response.json();
        const text = data.content?.[0]?.text || '';
        // Parsa JSON (kan vara inbäddat i ```json ... ```)
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) return JSON.parse(jsonMatch[0]);
        return null;
    } catch (err) {
        console.error(`  ⚠️  AI-sammanfattning misslyckades: ${err.message}`);
        return null;
    }
}

function buildHtml(categorized, editorial, date, totalSources) {
    const dateStr = date.toISOString().split('T')[0];
    const displayDate = date.toLocaleDateString('sv-SE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const cats = Object.entries(categorized).filter(([_, items]) => items.length > 0);
    const totalItems = cats.reduce((s, [_, i]) => s + i.length, 0);

    let editorialHtml = '';
    if (editorial) {
        editorialHtml = `
        <div class="editorial">
            <h2 class="headline">${escapeHtml(editorial.headline || 'Dagens AI-nyheter')}</h2>
            <p class="intro">${escapeHtml(editorial.intro || '')}</p>
        </div>
        `;
        if (editorial.sections && editorial.sections.length > 0) {
            editorialHtml += `        <h2 class="section-title">📝 Redaktionell analys</h2>\n`;
            for (const sec of editorial.sections) {
                editorialHtml += `        <div class="analysis">\n`;
                editorialHtml += `            <h3>${escapeHtml(sec.category)}</h3>\n`;
                editorialHtml += `            <p>${escapeHtml(sec.analysis || '')}</p>\n`;
                editorialHtml += `        </div>\n`;
            }
        }
    } else {
        editorialHtml = `
        <div class="editorial">
            <h2 class="headline">Dagens AI-nyheter</h2>
            <p class="intro">Här är ${totalItems} nyheter från senaste dygnet. Klicka på länkarna nedan för att läsa mer.</p>
        </div>
        `;
    }

    let detailsHtml = '';
    if (cats.length > 0) {
        detailsHtml = `        <h2 class="section-title">📰 Alla nyheter (${totalItems})</h2>\n`;
        for (const [cat, items] of cats) {
            detailsHtml += `        <section>\n`;
            detailsHtml += `            <h2>${escapeHtml(cat)} <span class="count">${items.length}</span></h2>\n`;
            for (const item of items) {
                const title = escapeHtml(item.title);
                const link = escapeHtml(item.link);
                const summary = item.summary ? `<p class="summary">${escapeHtml(item.summary)}</p>` : '';
                const pubDate = item.date && !isNaN(item.date.getTime())
                    ? `<span class="meta">🕒 ${item.date.toLocaleString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>`
                    : '';
                detailsHtml += `            <article>\n`;
                detailsHtml += `                <h3><a href="${link}" target="_blank" rel="noopener">${title}</a></h3>\n`;
                detailsHtml += `                ${summary}\n`;
                detailsHtml += `                <div class="meta">${pubDate} · <a href="${link}" target="_blank" rel="noopener">läs mer →</a></div>\n`;
                detailsHtml += `            </article>\n`;
            }
            detailsHtml += `        </section>\n`;
        }
    }

    return `<!DOCTYPE html>
<html lang="sv">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI News Daily — ${dateStr}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Orbitron:wght@400;700;900&display=swap');
        * { margin: 0; padding: 0; box-sizing: border-box; }
        :root {
            --cyan: #00ffff;
            --gold: #ffd700;
            --dark-bg: #0a0a0f;
            --charcoal: #1a1a2e;
            --panel-bg: #16213e;
            --text: #e0e0e0;
            --text-dim: #8892b0;
        }
        body {
            font-family: 'JetBrains Mono', monospace;
            background: var(--dark-bg);
            color: var(--text);
            min-height: 100vh;
            line-height: 1.8;
            padding: 40px 20px;
        }
        .container { max-width: 900px; margin: 0 auto; }
        header {
            text-align: center;
            margin-bottom: 40px;
            padding-bottom: 30px;
            border-bottom: 1px solid rgba(0, 255, 255, 0.3);
        }
        h1 {
            font-family: 'Orbitron', sans-serif;
            font-size: 2.2rem;
            color: var(--gold);
            margin-bottom: 8px;
            text-shadow: 0 0 20px rgba(255, 215, 0, 0.3);
        }
        .subtitle { color: var(--cyan); font-size: 0.9rem; letter-spacing: 2px; }
        .date { color: var(--text-dim); font-size: 0.85rem; margin-top: 8px; }

        .editorial {
            background: linear-gradient(135deg, rgba(0, 255, 255, 0.05), rgba(255, 215, 0, 0.05));
            border-left: 4px solid var(--gold);
            padding: 30px 35px;
            margin-bottom: 40px;
        }
        .headline {
            font-family: 'Orbitron', sans-serif;
            font-size: 1.6rem;
            color: var(--gold);
            margin-bottom: 18px;
            line-height: 1.3;
        }
        .intro {
            font-size: 1.05rem;
            color: var(--text);
            line-height: 1.7;
        }

        .section-title {
            font-family: 'Orbitron', sans-serif;
            font-size: 1.3rem;
            color: var(--cyan);
            margin: 40px 0 20px 0;
            padding-bottom: 10px;
            border-bottom: 1px solid rgba(0, 255, 255, 0.3);
        }

        .analysis {
            background: var(--panel-bg);
            border: 1px solid rgba(0, 255, 255, 0.2);
            padding: 25px 30px;
            margin-bottom: 18px;
        }
        .analysis h3 {
            color: var(--cyan);
            font-size: 1.1rem;
            margin-bottom: 12px;
        }
        .analysis p {
            color: var(--text);
            font-size: 0.98rem;
            line-height: 1.7;
        }

        section {
            background: var(--panel-bg);
            border: 1px solid rgba(0, 255, 255, 0.2);
            padding: 30px;
            margin-bottom: 25px;
        }
        h2 {
            font-family: 'Orbitron', sans-serif;
            font-size: 1.3rem;
            color: var(--cyan);
            margin-bottom: 20px;
            padding-bottom: 12px;
            border-bottom: 1px solid rgba(0, 255, 255, 0.3);
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .count {
            background: var(--gold);
            color: var(--dark-bg);
            padding: 2px 12px;
            font-size: 0.8rem;
            font-weight: 700;
            border-radius: 12px;
        }
        article {
            padding: 18px 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        }
        article:last-child { border-bottom: none; }
        h3 {
            color: var(--text);
            font-size: 1rem;
            margin-bottom: 8px;
            font-weight: 600;
        }
        h3 a {
            color: var(--text);
            text-decoration: none;
            border-bottom: 1px solid rgba(0, 255, 255, 0.3);
        }
        h3 a:hover { color: var(--cyan); }
        .summary {
            color: var(--text-dim);
            font-size: 0.92rem;
            margin-bottom: 8px;
            line-height: 1.6;
        }
        .meta {
            color: rgba(136, 146, 176, 0.7);
            font-size: 0.75rem;
        }
        .meta a { color: var(--cyan); text-decoration: none; }

        footer {
            text-align: center;
            margin-top: 50px;
            padding-top: 25px;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            color: var(--text-dim);
            font-size: 0.8rem;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>📡 AI News Daily</h1>
            <div class="subtitle">Daily editorial digest for Ombra Prime builders</div>
            <div class="date">${displayDate}</div>
        </header>

${editorialHtml}
${detailsHtml}
        <footer>
            🤖 AI-sammanfattning av Oris News Bot · ${totalItems} träffar från ${totalSources} källor
        </footer>
    </div>
</body>
</html>`;
}

function githubRequest(token, method, path, body) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const req = https.request({
            hostname: 'api.github.com',
            port: 443,
            path: path,
            method: method,
            headers: {
                'Authorization': `token ${token}`,
                'User-Agent': 'Oris-AI-News-Bot',
                'Content-Type': 'application/json',
                ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
            }
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (res.statusCode >= 400) reject(new Error(`GitHub ${res.statusCode}: ${parsed.message || data.substring(0, 200)}`));
                    else resolve(parsed);
                } catch (e) { reject(new Error(`Parse error: ${data.substring(0, 200)}`)); }
            });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

async function deployHtml(token, htmlContent, filename) {
    let sha = null;
    try {
        const existing = await githubRequest(token, 'GET', `/repos/${GITHUB_REPO}/contents/${filename}`);
        sha = existing.sha;
    } catch (e) { /* Fil finns inte */ }

    const body = {
        message: `Daily AI News — ${filename.replace('.html', '')}`,
        content: Buffer.from(htmlContent).toString('base64'),
        branch: GITHUB_BRANCH
    };
    if (sha) body.sha = sha;
    return githubRequest(token, 'PUT', `/repos/${GITHUB_REPO}/contents/${filename}`, body);
}

function sendDiscordMessage(token, channelId, content) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({ content });
        const req = https.request({
            hostname: 'discord.com',
            port: 443,
            path: `/api/v10/channels/${channelId}/messages`,
            method: 'POST',
            headers: {
                'Authorization': `Bot ${token}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                if (res.statusCode === 200 || res.statusCode === 201) resolve(JSON.parse(data));
                else reject(new Error(`Discord ${res.statusCode}: ${data.substring(0, 200)}`));
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

async function main() {
    console.log('🤖 AI News Bot startar...');
    const { discordToken, githubToken, minimaxKey } = getCredentials();
    if (!discordToken) { console.error('❌ Discord-token saknas'); process.exit(1); }
    if (!githubToken) { console.error('❌ GitHub-token saknas'); process.exit(1); }

    console.log(`📡 Hämtar ${SOURCES.length} källor...`);
    const allItems = [];
    for (const src of SOURCES) {
        try {
            const xml = await fetchUrl(src.url);
            const items = extractItems(xml).map(i => ({ ...i, sourceCat: src.cat }));
            allItems.push(...items);
            console.log(`✅ ${src.name}: ${items.length} artiklar`);
        } catch (err) {
            console.log(`❌ ${src.name}: ${err.message}`);
        }
    }

    const cutoff = Date.now() - 36 * 60 * 60 * 1000;
    const recent = allItems.filter(i => i.date.getTime() > cutoff);
    console.log(`🕒 ${recent.length} från senaste 36h`);

    const categorized = {};
    const seen = new Set();
    for (const item of recent) {
        const cat = categorize(item.title, item.sourceCat);
        if (!cat) continue;
        const key = item.title.substring(0, 50);
        if (seen.has(key)) continue;
        seen.add(key);
        if (!categorized[cat]) categorized[cat] = [];
        categorized[cat].push(item);
    }

    for (const cat of Object.keys(categorized)) {
        categorized[cat].sort((a, b) => b.date.getTime() - a.date.getTime());
    }

    const now = new Date();

    // AI-redaktionell sammanfattning
    let editorial = null;
    if (minimaxKey) {
        console.log('🤖 Skriver redaktionell sammanfattning med AI...');
        editorial = await generateEditorialSummary(minimaxKey, categorized, now);
        if (editorial) {
            console.log(`   Headline: "${editorial.headline}"`);
        }
    }

    const filename = `ai-news-${now.toISOString().split('T')[0]}.html`;
    const html = buildHtml(categorized, editorial, now, SOURCES.length);

    const localPath = path.join(__dirname, 'output', filename);
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, html);
    console.log(`💾 Sparad: ${localPath} (${(html.length/1024).toFixed(1)} KB)`);

    console.log(`📤 Deployar ${filename}...`);
    await deployHtml(githubToken, html, filename);
    const liveUrl = `https://steffost.github.io/ai-news/${filename}`;
    console.log(`✅ Deployad: ${liveUrl}`);

    const total = Object.values(categorized).reduce((s, i) => s + i.length, 0);
    const headline = editorial?.headline || 'Dagens AI-nyheter';
    const discordMsg = `📡 **AI News Daily** — ${now.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' })}\n\n` +
        `**${headline}**\n\n` +
        `${total} nyheter · ${Object.keys(categorized).filter(c => categorized[c].length > 0).length} kategorier\n\n` +
        `📖 Läs redaktionell sammanfattning: ${liveUrl}`;

    console.log(`📤 Skickar till Discord...`);
    await sendDiscordMessage(discordToken, CHANNEL_ID, discordMsg);
    console.log(`✅ Klart!`);
}

main().catch(err => {
    console.error('❌ Fel:', err.message);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
});
