/**
 * TG Matrix Kit — SSE-стрим участников и скачивание результатов экспорта.
 * Перенесено из site/matrix_v2 (packages/modules/telegram/src/tg_export.js).
 * Этот роутер в исходном server.js НЕ был смонтирован — здесь монтируется в server.js.
 */

const express = require('express');
const { getClient } = require('./tg_auth');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const EXPORTS_DIR = path.join(__dirname, '..', 'exports');

// SSE-стрим участников (для живого списка на фронтенде)
router.get('/participants-stream', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    try {
        const client = await getClient(req.query.sid);
        if (!client) throw new Error('Клиент не инициализирован. Авторизуйтесь заново.');

        const entity = await client.getEntity(String(req.query.id).startsWith('-100') ? BigInt(req.query.id) : req.query.id);
        let count = 0;
        for await (const p of client.iterParticipants(entity, { limit: 500 })) {
            const name = ((p.firstName || '') + (p.lastName ? ' ' + p.lastName : '')) || p.username || 'Unknown';
            res.write(`data: ${JSON.stringify({ id: p.id.toString(), name })}\n\n`);
            count++;
        }
        res.write(`data: ${JSON.stringify({ done: true, total: count })}\n\n`);
    } catch (e) { res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`); }
    res.end();
});

// Защита от path traversal: отдаём только файлы из exports/
router.get('/download-extra', (req, res) => {
    const name = path.basename(String(req.query.file || ''));
    const full = path.join(EXPORTS_DIR, name);
    if (!name || !fs.existsSync(full)) return res.status(404).send('Not Found');
    res.download(full);
});

module.exports = router;
