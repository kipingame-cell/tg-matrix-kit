/**
 * TG Matrix Kit — авторизация Telegram (GramJS), ручной поток sendCode/signIn.
 * Маскировка: Samsung Galaxy S23 Ultra / Android 13.0 / Telegram 9.6.5 — отпечаток реального клиента.
 * Доставка кода логируется: тип виден в ответе API и в логе (APP / SMS / CALL / FLASH_CALL).
 * Повторная отправка кода: POST /resend-code (переключает канал: приложение → SMS → звонок).
 * Подключение: direct → Tor фолбэк (USE_TOR=0 отключает, FORCE_TOR=1 — только Tor).
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { computeCheck } = require('telegram/Password');
const router = express.Router();

const ROOT_DIR = path.resolve(__dirname, '..');
const SESSIONS_DIR = path.join(ROOT_DIR, 'tg_sessions');
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

const activeClients = {};
const backgroundTasks = {};

const ENCRYPTION_SALT = process.env.SESSION_SECRET || 'change-me-in-env';
const APP_API_ID = Number(process.env.TELEGRAM_API_ID || 6);
const APP_API_HASH = process.env.TELEGRAM_API_HASH || 'eb06d4abfb49dc3eeb1aeb98ae0f581e';

// --- МАСКИРОВКА: точный отпечаток Samsung Galaxy S23 Ultra, Android 13.0, Telegram 9.6.5 ---
const DEVICE_FINGERPRINT = {
    deviceModel: 'Samsung Galaxy S23 Ultra',
    systemVersion: 'Android 13.0',
    appVersion: '9.6.5',
    langCode: 'ru',
    systemLangCode: 'ru-RU'
};

const TOR_PROXY = { ip: '127.0.0.1', port: 9050, socksType: 5, timeout: 60 };
const CONNECT_TIMEOUT_MS = 25000;

function clientOpts(useTor) {
    return {
        ...DEVICE_FINGERPRINT,
        connectionRetries: 5,
        requestRetries: 5,
        timeout: 30,
        retryDelay: 1000,
        proxy: useTor ? TOR_PROXY : undefined
    };
}

function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Таймаут ${ms / 1000}с (${label})`)), ms))
    ]);
}

async function connectSmart(sessionString) {
    const modes = process.env.FORCE_TOR === '1'
        ? ['tor']
        : (process.env.USE_TOR === '0' ? ['direct'] : ['direct', 'tor']);

    let lastErr = null;
    for (const mode of modes) {
        let client = null;
        try {
            console.log(`[NET] Подключение к Telegram... режим: ${mode.toUpperCase()}`);
            client = new TelegramClient(new StringSession(sessionString || ''), APP_API_ID, APP_API_HASH, clientOpts(mode === 'tor'));
            await withTimeout(client.connect(), CONNECT_TIMEOUT_MS, mode);
            console.log(`[NET] Соединение установлено (${mode.toUpperCase()}).`);
            return client;
        } catch (e) {
            lastErr = e;
            console.error(`[NET] Режим ${mode.toUpperCase()} не сработал: ${e.message}`);
            try { if (client) await client.destroy(); } catch (_) {}
        }
    }
    throw lastErr || new Error('Не удалось подключиться ни одним способом');
}

function encryptSession(text, sid) {
    const key = crypto.scryptSync(sid, ENCRYPTION_SALT, 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

function decryptSession(encryptedText, sid) {
    try {
        const textParts = encryptedText.split(':');
        const iv = Buffer.from(textParts.shift(), 'hex');
        const key = crypto.scryptSync(sid, ENCRYPTION_SALT, 32);
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        let decrypted = decipher.update(textParts.join(':'), 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e) { return null; }
}

async function getClient(sid) {
    if (!sid) return null;
    if (activeClients[sid]?.tgClient?.connected) return activeClients[sid].tgClient;
    if (activeClients[sid]?.connectionPromise) return activeClients[sid].connectionPromise;

    if (!activeClients[sid]) activeClients[sid] = {};

    activeClients[sid].connectionPromise = (async () => {
        const sessionPath = path.join(SESSIONS_DIR, `${sid}.json`);
        if (!fs.existsSync(sessionPath)) return null;

        try {
            console.log(`[AUTH] Восстановление сессии ${sid}...`);
            const data = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
            let sessionString = data.session;

            if (sessionString && sessionString.includes(':')) {
                sessionString = decryptSession(sessionString, sid);
            }

            const client = await connectSmart(sessionString || '');
            activeClients[sid].tgClient = client;
            return client;
        } catch (err) {
            console.error('[AUTH] Критическая ошибка:', err.message);
            delete activeClients[sid].connectionPromise;
            return null;
        }
    })();

    return activeClients[sid].connectionPromise;
}

function saveSession(sid) {
    const state = activeClients[sid];
    if (state?.tgClient?.session) {
        const raw = state.tgClient.session.save();
        fs.writeFileSync(path.join(SESSIONS_DIR, `${sid}.json`), JSON.stringify({ session: encryptSession(raw, sid) }));
        console.log(`[AUTH] Сессия ${sid} сохранена (зашифрована).`);
    }
}

function toEntityId(id) {
    return String(id).startsWith('-100') ? BigInt(id) : id;
}

function fmtErr(err) {
    if (err && err.errorMessage) {
        if (err.errorMessage.startsWith('FLOOD_WAIT')) {
            return `Telegram временно ограничил запросы. Подождите ${err.errorMessage.replace('FLOOD_WAIT_', '')} сек. и повторите.`;
        }
        if (err.errorMessage === 'PHONE_NUMBER_INVALID') return 'Номер не зарегистрирован в Telegram или введён с ошибкой.';
        if (err.errorMessage === 'PHONE_CODE_INVALID') return 'Неверный код. Проверьте и введите снова.';
        if (err.errorMessage === 'PHONE_CODE_EXPIRED') return 'Код истёк. Запросите новый (кнопка повторной отправки).';
        if (err.errorMessage === 'PASSWORD_HASH_INVALID') return 'Неверный пароль 2FA.';
        return `Telegram: ${err.errorMessage}`;
    }
    return err.message || String(err);
}

router.get('/check', (req, res) => res.json({ active: fs.existsSync(path.join(SESSIONS_DIR, `${req.query.sid}.json`)) }));

// --- ОТПРАВКА КОДА (ручной sendCode: видим тип доставки) ---
router.post('/send-code', async (req, res) => {
    const { sid, phone } = req.body;
    try {
        console.log(`[AUTH] Запрос кода для ${phone} (sid=${sid})...`);
        if (activeClients[sid]?.tgClient) { try { await activeClients[sid].tgClient.destroy(); } catch (_) {} }

        const client = await connectSmart('');

        const sent = await client.invoke(new Api.auth.SendCode({
            phoneNumber: phone,
            apiId: APP_API_ID,
            apiHash: APP_API_HASH,
            settings: new Api.CodeSettings()
        }));

        const deliveryType = sent.type ? sent.type.className : 'Unknown';
        activeClients[sid] = { tgClient: client, phone, phoneCodeHash: sent.phoneCodeHash, deliveryType };

        console.log(`[AUTH] Код отправлен. Канал доставки: ${deliveryType}`);
        res.json({ success: true, deliveryType });
    } catch (err) {
        console.error('[AUTH] Ошибка отправки кода:', fmtErr(err));
        res.status(500).json({ success: false, error: fmtErr(err) });
    }
});

// --- ПОВТОРНАЯ ОТПРАВКА (переключает канал: приложение → SMS → звонок) ---
router.post('/resend-code', async (req, res) => {
    const { sid } = req.body;
    try {
        const state = activeClients[sid];
        if (!state || !state.phoneCodeHash) throw new Error('Сначала запросите код (введите номер).');

        console.log(`[AUTH] Повторный запрос кода для ${state.phone}...`);
        const sent = await state.tgClient.invoke(new Api.auth.ResendCode({
            phoneNumber: state.phone,
            phoneCodeHash: state.phoneCodeHash
        }));

        state.phoneCodeHash = sent.phoneCodeHash;
        const deliveryType = sent.type ? sent.type.className : 'Unknown';
        console.log(`[AUTH] Код переотправлен. Канал: ${deliveryType}`);
        res.json({ success: true, deliveryType });
    } catch (err) {
        console.error('[AUTH] Ошибка повторной отправки:', fmtErr(err));
        res.status(500).json({ success: false, error: fmtErr(err) });
    }
});

// --- ВХОД ПО КОДУ ---
router.post('/login', async (req, res) => {
    const { sid, code } = req.body;
    try {
        const state = activeClients[sid];
        if (!state || !state.phoneCodeHash) throw new Error('Контекст утерян. Запросите код заново.');
        console.log(`[AUTH] Проверка кода (sid=${sid})...`);

        await state.tgClient.invoke(new Api.auth.SignIn({
            phoneNumber: state.phone,
            phoneCodeHash: state.phoneCodeHash,
            phoneCode: String(code).trim()
        }));

        saveSession(sid);
        console.log('[AUTH] Вход выполнен.');
        res.json({ success: true });
    } catch (err) {
        if (err.errorMessage === 'SESSION_PASSWORD_NEEDED') {
            console.log('[AUTH] Требуется 2FA-пароль.');
            return res.json({ success: false, requiresPassword: true });
        }
        console.error('[AUTH] Ошибка кода:', fmtErr(err));
        res.status(500).json({ success: false, error: fmtErr(err) });
    }
});

// --- ВХОД ПО 2FA-ПАРОЛЮ (SRP) ---
router.post('/password', async (req, res) => {
    const { sid, password } = req.body;
    try {
        const state = activeClients[sid];
        if (!state) throw new Error('Контекст утерян. Запросите код заново.');
        console.log(`[AUTH] Проверка 2FA (sid=${sid})...`);

        const pwdSrp = await state.tgClient.invoke(new Api.account.GetPassword());
        const check = await computeCheck(pwdSrp, password);
        await state.tgClient.invoke(new Api.auth.CheckPassword({ password: check }));

        saveSession(sid);
        console.log('[AUTH] Вход по 2FA выполнен.');
        res.json({ success: true });
    } catch (err) {
        console.error('[AUTH] Ошибка 2FA:', fmtErr(err));
        res.status(500).json({ success: false, error: fmtErr(err) });
    }
});

router.get('/chats', async (req, res) => {
    try {
        const client = await getClient(req.query.sid);
        if (!client) return res.status(401).json({ success: false });
        const dialogs = await client.getDialogs({});
        res.json({ success: true, chats: dialogs.map(d => ({ id: d.id.toString(), name: d.title || d.name || 'Unknown' })) });
    } catch (err) { res.status(500).json({ success: false, error: fmtErr(err) }); }
});

// Список топиков форума
router.get('/topics', async (req, res) => {
    try {
        const client = await getClient(req.query.sid);
        if (!client) return res.status(401).json({ success: false });
        const entity = await client.getEntity(toEntityId(req.query.id));
        const result = await client.invoke(new Api.channels.GetForumTopics({
            channel: entity,
            offsetDate: 0,
            offsetId: 0,
            offsetTopic: 0,
            limit: 100
        }));
        const topics = (result.topics || [])
            .filter(t => t instanceof Api.ForumTopic)
            .map(t => ({ id: t.id, title: t.title }));
        res.json({ success: true, topics });
    } catch (err) {
        res.json({ success: true, topics: [] });
    }
});

router.get('/participants', async (req, res) => {
    try {
        const client = await getClient(req.query.sid);
        const entity = await client.getEntity(toEntityId(req.query.id));
        let p = [];
        for await (const u of client.iterParticipants(entity, { limit: 500 })) { p.push(u); }
        res.json({ success: true, users: p.map(u => ({ id: u.id.toString(), name: u.firstName || u.username })) });
    } catch (err) { res.status(500).json({ success: false, error: fmtErr(err) }); }
});

// --- ФОНОВЫЕ РОУТЫ ЭКСПОРТА --- //
router.post('/export/start', async (req, res) => {
    const sid = req.body.sid;
    if (backgroundTasks[sid] && backgroundTasks[sid].status === 'running') {
        return res.json({ success: true, message: 'Уже запущен' });
    }

    const client = await getClient(sid);
    if (!client) return res.status(401).json({ error: 'Нет сессии' });

    backgroundTasks[sid] = {
        status: 'running',
        clients: [],
        stop: false,
        lastState: { percent: 0, processed: 0, exported: 0, total: req.body.limit || 'Неизвестно' },
        logsHistory: ['[СИСТЕМА] Подключение к фоновой задаче установлено...'],
        result: null
    };

    const task = backgroundTasks[sid];
    const broadcast = (data) => {
        if (data.processed !== undefined) {
            task.lastState.processed = data.processed;
            task.lastState.exported = data.exported;
            if (data.percent !== undefined) task.lastState.percent = data.percent;
            if (data.total !== undefined) task.lastState.total = data.total;
        }
        if (data.log) {
            task.logsHistory.push(data.log);
            if (task.logsHistory.length > 50) task.logsHistory.shift();
        }
        task.clients.forEach(c => c.write(`data: ${JSON.stringify(data)}\n\n`));
    };

    const { exportChatMessages } = require('./telegram_core');

    exportChatMessages(client, req.body.id, req.body, task, (progress) => {
        broadcast({ type: 'monitor_update', ...progress });
    }).then(result => {
        task.status = 'done'; task.result = result;
        broadcast({ type: 'archive_ready', downloadUrl: `/api/tg/download-extra?file=${result.zip}`, extras: result });
        broadcast({ type: 'done' });
    }).catch(err => {
        task.status = 'error';
        broadcast({ type: 'error', msg: fmtErr(err) });
    });

    res.json({ success: true });
});

router.get('/export/stream', (req, res) => {
    const sid = req.query.sid;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const task = backgroundTasks[sid];
    if (!task) {
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        return;
    }

    task.clients.push(res);
    res.write(`data: ${JSON.stringify({ type: 'monitor_update', ...task.lastState })}\n\n`);
    task.logsHistory.forEach(l => {
        res.write(`data: ${JSON.stringify({ type: 'monitor_update', log: l })}\n\n`);
    });

    if (task.status === 'done' && task.result) {
        res.write(`data: ${JSON.stringify({ type: 'archive_ready', downloadUrl: `/api/tg/download-extra?file=${task.result.zip}`, extras: task.result })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    } else if (task.status === 'error') {
        res.write(`data: ${JSON.stringify({ type: 'error', msg: 'Ошибка фоновой задачи' })}\n\n`);
    }

    req.on('close', () => { task.clients = task.clients.filter(c => c !== res); });
});

router.get('/export/status', (req, res) => {
    const task = backgroundTasks[req.query.sid];
    res.json({ active: !!(task && task.status === 'running') });
});

router.post('/export/stop', (req, res) => {
    if (backgroundTasks[req.body.sid]) backgroundTasks[req.body.sid].stop = true;
    res.json({ success: true });
});

module.exports = { router, getClient, sessions: activeClients };
