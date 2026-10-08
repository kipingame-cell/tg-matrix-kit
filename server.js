/**
 * TG Matrix Kit — standalone-сервер.
 * /tg/       — терминал выгрузки чатов
 * /graph/    — просмотр графа связей (D3)
 * /heatmap/  — телеметрия активности (Chart.js)
 * /api/tg/*  — авторизация, экспорт, скачивание
 */
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: '5mb' }));

// API
const { router: tgAuthRouter } = require('./src/tg_auth');
const tgExportRouter = require('./src/tg_export');
app.use('/api/tg', tgAuthRouter);
app.use('/api/tg', tgExportRouter); // в исходном matrix_v2 этот роутер не был смонтирован — /topics, /participants-stream, /download-extra падали

// Статика
const PUB = path.join(__dirname, 'public');
['tg', 'graph', 'heatmap'].forEach(d => {
    app.use(`/${d}`, express.static(path.join(PUB, d)));
});

app.get('/', (req, res) => res.redirect('/tg/'));

['exports', 'tg_sessions'].forEach(d => {
    const p = path.join(__dirname, d);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

const HOST = process.env.HOST || '127.0.0.1';
const server = app.listen(PORT, HOST, () => console.log(`[TG MATRIX KIT] Терминал активен: http://localhost:${PORT}/tg/`));
server.timeout = 600000;
server.keepAliveTimeout = 600000;
