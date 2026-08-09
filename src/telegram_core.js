/**
 * TG Matrix Kit — ядро экспорта чатов (TXT/HTML/JSON + граф + радар + досье).
 * Перенесено из site/matrix_v2 (packages/modules/telegram/src/telegram_core.js) без изменений логики.
 */

const { Api } = require('telegram');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { buildDeepProfile } = require('./ai_engine');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const esc = (str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const getHtmlHeader = (title, part) => `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><title>${title} // ЧАСТЬ ${part}</title><style>body{background:#0a0a0a;color:#e0e0e0;font-family:'JetBrains Mono',monospace;padding:20px;} .container{max-width:900px;margin:0 auto;border:2px solid #b71c1c;padding:4px;background:#111;box-shadow:0 0 15px rgba(183,28,28,0.2);} .inner{border:1px solid #333;padding:20px;background:repeating-linear-gradient(0deg,#111,#111 2px,#151515 2px,#151515 4px);} h1{color:#fbc02d;text-align:center;border-bottom:2px solid #b71c1c;text-transform:uppercase;letter-spacing:3px;font-size:1.5em;padding-bottom:10px;margin-top:0;} .msg{border:1px solid #333;padding:12px;margin-bottom:12px;background:#151515;border-left:4px solid #b71c1c;transition:0.2s;} .msg:hover{background:#1a1a1a;border-left-color:#fbc02d;} .head{display:flex;justify-content:space-between;font-size:12px;color:#777;margin-bottom:8px;border-bottom:1px dashed #333;padding-bottom:4px;} .sender{color:#fbc02d;font-size:14px;font-weight:bold;text-transform:uppercase;} .reply{font-size:11px;color:#b71c1c;text-decoration:none;display:block;margin-bottom:8px;border-left:2px solid #b71c1c;padding-left:5px;background:rgba(183,28,28,0.05);} .text{font-size:14px;line-height:1.5;white-space:pre-wrap;color:#d0d0d0;}</style></head><body><div class="container"><div class="inner"><h1>ПЕРЕХВАТ: ${title} // БЛОК ${part}</h1><div id="chat">`;

async function exportChatMessages(client, chatId, options, taskState, progressCallback) {
    chatId = String(chatId);
    const entity = await client.getEntity(chatId.startsWith('-100') ? BigInt(chatId) : chatId);
    const iterOpts = {};

    let totalMessages = 'Неизвестно';
    if (options.limit && options.limit.toString().trim() !== '') {
        iterOpts.limit = parseInt(options.limit);
        totalMessages = iterOpts.limit;
    }

    if (options.topicId) iterOpts.replyTo = parseInt(options.topicId);

    const keywordFilter = options.keywords && options.keywords.trim() !== '' ? options.keywords.trim().toLowerCase() : null;
    const userFilter = options.fromUser && options.fromUser.trim() !== '' ? String(options.fromUser).trim() : null;
    const exportMode = options.exportMode || 'all';

    const buildMedia = options.downloadMedia === true || options.downloadMedia === 'true';
    const buildDossier = options.buildDossier === true || options.buildDossier === 'true';
    const buildHeatmap = options.buildHeatmap === true || options.buildHeatmap === 'true';
    const buildGraph = options.buildGraph === true || options.buildGraph === 'true';

    const exportDir = path.join(__dirname, '..', 'exports');
    if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

    const safeName = (entity.title || entity.firstName || 'chat').replace(/[^a-zA-Zа-яА-Я0-9]/g, '_').substring(0, 30);
    const baseFileName = `${new Date().toISOString().slice(0, 10)}_${safeName}`;
    const zip = new AdmZip();

    let count = 0, processedCount = 0, partNum = 1;
    let txtChunk = '', htmlChunk = getHtmlHeader(baseFileName, partNum), jsonChunk = [];

    const users = new Map(), rawActivityLog = [], userQuotes = new Map(), rawMessages = [];
    const graphNodes = new Map(), graphLinks = new Map(), msgSenderMap = new Map();
    const pendingLinks = [];

    const flushChunks = () => {
        if (txtChunk.length === 0) return;
        zip.addFile(`${baseFileName}_part${partNum}.txt`, Buffer.from(txtChunk, 'utf8'));
        zip.addFile(`${baseFileName}_part${partNum}.html`, Buffer.from(htmlChunk + `</div></div></div></body></html>`, 'utf8'));
        zip.addFile(`${baseFileName}_part${partNum}.json`, Buffer.from(JSON.stringify(jsonChunk, null, 2), 'utf8'));
        partNum++; txtChunk = ''; htmlChunk = getHtmlHeader(baseFileName, partNum); jsonChunk = [];
    };

    progressCallback({ log: `Фоновый процесс запущен. Аналитика: ${[buildDossier ? 'ДОСЬЕ' : '', buildHeatmap ? 'РАДАР' : '', buildGraph ? 'ГРАФ' : ''].filter(Boolean).join(', ') || 'ВЫКЛ'}` });

    for await (const message of client.iterMessages(entity, iterOpts)) {
        if (taskState && taskState.stop) { progressCallback({ log: '[СИСТЕМА] Процесс остановлен пользователем.' }); break; }

        processedCount++;
        if (processedCount % 50 === 0) {
            const jitter = Math.floor(Math.random() * 2000) + 1000;
            progressCallback({ processed: processedCount, exported: count, total: totalMessages, log: `[СИСТЕМА] Обход лимитов API. Пауза: ${jitter}ms...` });
            await sleep(jitter);
        }

        const msgTs = message.date * 1000;
        if (options.dateFrom && msgTs < parseInt(options.dateFrom)) break;
        if (options.dateTo && msgTs > parseInt(options.dateTo)) continue;
        if (exportMode === 'text' && message.media) continue;
        if (exportMode === 'media' && !message.media) continue;

        const sender = message.sender ? (message.sender.firstName || message.sender.username || 'Unknown') : 'Unknown';
        const text = message.message || '';

        if (userFilter && message.senderId?.toString() !== userFilter) continue;
        if (keywordFilter && !text.toLowerCase().includes(keywordFilter)) continue;

        count++;

        const msgIdStr = String(message.id);
        let replyIdStr = null;
        if (message.replyToMsgId) replyIdStr = String(message.replyToMsgId);
        else if (message.replyTo && message.replyTo.replyToMsgId) replyIdStr = String(message.replyTo.replyToMsgId);

        let mediaMarkup = '';
        if (buildMedia && message.media) {
            try {
                const buff = await client.downloadMedia(message, { thumb: 1 });
                if (buff) {
                    const mediaName = `preview_${message.id}.jpg`;
                    zip.addFile(`media/${mediaName}`, buff);
                    mediaMarkup = `<br><img src="media/${mediaName}" style="max-width: 250px; border-radius: 8px; margin-top: 5px; border: 1px solid #5a5a5f;">`;
                }
            } catch (e) { mediaMarkup = `<div style="color:#cc0000; font-size:10px; margin-top:5px;">[ОШИБКА ПРЕВЬЮ МЕДИА]</div>`; }
        }

        users.set(sender, (users.get(sender) || 0) + 1);
        rawActivityLog.push({ user: sender, ts: msgTs });
        msgSenderMap.set(msgIdStr, sender);
        graphNodes.set(sender, (graphNodes.get(sender) || 0) + 1);

        if (replyIdStr) pendingLinks.push({ source: sender, targetId: replyIdStr });

        if (text) {
            rawMessages.push({ id: msgIdStr, sender: sender, text: text, replyTo: replyIdStr });
            if (!userQuotes.has(sender)) userQuotes.set(sender, []);
            if (userQuotes.get(sender).length < 20) userQuotes.get(sender).push(text);
        }

        const timeStr = new Date(msgTs).toLocaleString();
        const txtReply = replyIdStr ? ` (В ответ на #${replyIdStr})` : '';
        const htmlReply = replyIdStr ? `<div class="reply">↳ Ответ на сообщение #${replyIdStr}</div>` : '';

        txtChunk += `[${timeStr}] ${sender}${txtReply}: ${text}\n`;
        htmlChunk += `<div class="msg">${htmlReply}<div class="head"><span class="sender">${sender}</span><span class="time">${timeStr}</span></div><div class="text">${text}${mediaMarkup}</div></div>`;
        jsonChunk.push({ id: message.id, ts: timeStr, sender, replyTo: replyIdStr || null, text });

        if (count % 25 === 0 && (Buffer.byteLength(txtChunk) + Buffer.byteLength(htmlChunk) > 500 * 1024)) flushChunks();

        let shouldLog = false;
        if (keywordFilter || userFilter) shouldLog = true;
        else if (processedCount % 10 === 0) shouldLog = true;

        if (shouldLog) {
            let shortText = text.replace(/\n/g, ' ').substring(0, 45);
            if (shortText.length === 0 && message.media) shortText = '[МЕДИАФАЙЛ]';
            progressCallback({
                processed: processedCount, exported: count, total: totalMessages,
                percent: totalMessages !== 'Неизвестно' ? Math.round((processedCount / totalMessages) * 100) : 0,
                log: `[+] ${sender}${txtReply}: ${shortText}...`
            });
        }
    }

    flushChunks();

    pendingLinks.forEach(link => {
        if (msgSenderMap.has(link.targetId)) {
            const target = msgSenderMap.get(link.targetId);
            if (link.source !== target) {
                const linkKey = `${link.source}->${target}`;
                graphLinks.set(linkKey, { source: link.source, target: target, value: (graphLinks.get(linkKey)?.value || 0) + 1 });
            }
        }
    });

    const apiKey = options.aiKeys ? options.aiKeys.split(',')[0].trim() : null;

    if (buildDossier && apiKey) {
        progressCallback({ log: `[ИИ] Инициализация глубокого профайлинга...` });
        const dossier = await buildDeepProfile(apiKey, userQuotes, progressCallback);
        fs.writeFileSync(path.join(exportDir, 'latest_dossier.html'), dossier);
        progressCallback({ log: `[ИИ] Отчет профайлинга успешно сохранен.` });
    } else if (buildDossier && !apiKey) {
        fs.writeFileSync(path.join(exportDir, 'latest_dossier.html'), `<div style="background:#0a0a0a;color:#cc0000;font-family:monospace;padding:20px;border:2px solid #cc0000;">[СИСТЕМНЫЙ СБОЙ]: API КЛЮЧ НЕ ЗАДАН.</div>`);
    }

    if (buildHeatmap) fs.writeFileSync(path.join(exportDir, 'latest_heatmap.json'), JSON.stringify(rawActivityLog));

    if (buildGraph) {
        let graphml = `<?xml version="1.0" encoding="UTF-8"?>\n<graphml>\n  <graph id="G" edgedefault="directed">\n`;
        Array.from(graphNodes.entries()).forEach(([id, weight]) => {
            const safeId = esc(id);
            graphml += `    <node id="${safeId}"><data key="name">${safeId}</data></node>\n`;
        });
        Array.from(graphLinks.values()).forEach(link => {
            const s = esc(link.source), t = esc(link.target);
            graphml += `    <edge source="${s}" target="${t}"><data key="weight">${link.value}</data><data key="label">Общение</data></edge>\n`;
        });
        graphml += `  </graph>\n</graphml>`;

        fs.writeFileSync(path.join(exportDir, 'latest_graph.xml'), graphml);
        zip.addFile(`graph_data.xml`, Buffer.from(graphml, 'utf8'));
        progressCallback({ log: `[СИСТЕМА] Граф связей (Узлов: ${graphNodes.size}, Связей: ${graphLinks.size}) построен.` });
    }

    const archiveName = `archive_${chatId}_${Date.now()}.zip`;
    zip.writeZip(path.join(exportDir, archiveName));

    return {
        zip: archiveName,
        graph: buildGraph ? `/api/tg/download-extra?file=latest_graph.xml` : null,
        dossier: buildDossier ? `/api/tg/download-extra?file=latest_dossier.html` : null,
        heatmap: buildHeatmap ? `/api/tg/download-extra?file=latest_heatmap.json` : null
    };
}
module.exports = { exportChatMessages };
