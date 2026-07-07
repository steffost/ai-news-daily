#!/usr/bin/env node
/**
 * test-rss.js - Testar RSS-hämtning UTAN att skicka till Discord
 */

import https from 'https';
import http from 'http';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCES = [
    { name: 'GN Lokal AI', url: 'https://news.google.com/rss/search?q=%22local+AI%22+OR+%22ollama%22+OR+%22llamafile%22+OR+%22on-device+AI%22&hl=en-US&gl=US&ceid=US:en', cat: '🖥️ Lokal AI' },
    { name: 'GN Musik-AI', url: 'https://news.google.com/rss/search?q=%22music+generation%22+OR+%22suno%22+OR+%22udio%22+OR+%22stable+audio%22+OR+%22voice+clone%22&hl=en-US&gl=US&ceid=US:en', cat: '🎵 Musik-AI' },
    { name: 'GN 3D-AI', url: 'https://news.google.com/rss/search?q=%22text-to-3d%22+OR+%22gaussian+splatting%22+OR+%22mesh+generation%22+OR+%22nerf%22&hl=en-US&gl=US&ceid=US:en', cat: '🎨 3D-AI' },
    { name: 'GN Blender', url: 'https://news.google.com/rss/search?q=%22blender%22+AND+%22AI%22&hl=en-US&gl=US&ceid=US:en', cat: '🧊 Blender' },
    { name: 'GN Unreal', url: 'https://news.google.com/rss/search?q=%22unreal+engine%22+AND+%22AI%22+OR+%22ue5%22+OR+%22metahuman%22&hl=en-US&gl=US&ceid=US:en', cat: '🎮 Unreal' },
    { name: 'Hacker News AI', url: 'https://hnrss.org/newest?q=AI+OR+LLM+OR+stable+diffusion&points=30' }
];

function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https') ? https : http;
        const req = lib.get(url, {
            headers: { 'User-Agent': 'Oris-AI-News-Bot/1.0' }
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetchUrl(res.headers.location).then(resolve, reject);
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode}`));
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.setTimeout(15000, () => {
            req.destroy();
            reject(new Error('Timeout'));
        });
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
        if (t) {
            items.push({
                title: t[1].replace(/<[^>]+>/g, '').trim(),
                link: l ? l[1].trim() : '',
                date: d ? new Date(d[1].trim()) : new Date(0)
            });
        }
    }
    return items;
}

async function main() {
    console.log('🧪 TEST: Hämtar RSS\n');
    const results = [];
    for (const src of SOURCES) {
        try {
            const xml = await fetchUrl(src.url);
            const items = extractItems(xml);
            results.push({ src, items, ok: true });
        } catch (err) {
            results.push({ src, error: err.message, ok: false });
        }
    }

    const categorized = {};
    let totalRecent = 0;

    for (const r of results) {
        if (!r.ok) {
            console.log(`❌ ${r.src.name}: ${r.error}`);
            continue;
        }
        const recent = r.items.filter(i => Date.now() - i.date.getTime() < 36 * 60 * 60 * 1000);
        console.log(`✅ ${r.src.name}: ${r.items.length} artiklar, ${recent.length} senaste 36h${r.src.cat ? ' → ' + r.src.cat : ''}`);
        totalRecent += recent.length;

        if (r.src.cat) {
            for (const item of recent) {
                if (!categorized[r.src.cat]) categorized[r.src.cat] = [];
                categorized[r.src.cat].push({ ...item, source: r.src.name });
            }
        }
    }

    console.log(`\n📰 ${totalRecent} artiklar från senaste 36h`);
    console.log(`\n🎯 Kategoriserade träffar:`);
    for (const [cat, items] of Object.entries(categorized)) {
        console.log(`\n  ${cat} (${items.length}):`);
        for (const item of items.slice(0, 3)) {
            console.log(`    • ${item.title.substring(0, 80)}`);
        }
    }
}

main().catch(e => {
    console.error('Fel:', e.message);
    process.exit(1);
});
