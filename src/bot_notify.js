/**
 * TG Matrix Kit — пуш-уведомления о завершении выгрузки через Telegram-бота.
 * Настройка в .env: TG_BOT_TOKEN (токен от @BotFather), TG_CHAT_ID (куда слать).
 * Опционально: TG_PROXY=socks5://127.0.0.1:9050 — отправка через Tor/прокси.
 * ZIP прикладывается к пушу, если меньше ~45 МБ (лимит Bot API); иначе — только уведомление.
 */

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

function getAgent() {
    const proxy = process.env.TG_PROXY;
    if (proxy) {
        const { SocksProxyAgent } = require('socks-proxy-agent');
        return new SocksProxyAgent(proxy);
    }
    return undefined;
}

async function sendText(token, chatId, text, agent) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
        agent
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.description || 'Bot API error');
}

async function sendZip(token, chatId, filePath, caption, agent) {
    const fileBuf = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    const boundary = '----tgkit' + Date.now().toString(16);

    const head = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${fileName}"\r\nContent-Type: application/zip\r\n\r\n`,
        'utf8'
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    const body = Buffer.concat([head, fileBuf, tail]);

    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body,
        agent,
        timeout: 120000
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.description || 'Bot API error (document)');
}

async function notifyExportDone(result, options) {
    const token = process.env.TG_BOT_TOKEN;
    const chatId = process.env.TG_CHAT_ID;
    if (!token || !chatId) return;

    const agent = getAgent();
    const exported = result.exportedCount !== undefined ? result.exportedCount : '?';
    const caption = `✅ ВЫГРУЗКА ЗАВЕРШЕНА\nЧат ID: ${options.id}\nСообщений выгружено: ${exported}\nАрхив: ${result.zip}`;

    const zipPath = path.join(__dirname, '..', 'exports', result.zip);
    const MAX_BOT_FILE = 45 * 1024 * 1024;

    try {
        if (fs.existsSync(zipPath) && fs.statSync(zipPath).size < MAX_BOT_FILE) {
            await sendZip(token, chatId, zipPath, caption, agent);
            console.log('[PUSH] Пуш с архивом отправлен в Telegram.');
        } else {
            await sendText(token, chatId, caption + '\n\n(Архив больше 45 МБ — заберите через терминал)', agent);
            console.log('[PUSH] Пуш отправлен (архив слишком большой для бота).');
        }
    } catch (e) {
        console.error('[PUSH] Не удалось отправить пуш:', e.message);
    }
}

async function notifyExportError(err, options) {
    const token = process.env.TG_BOT_TOKEN;
    const chatId = process.env.TG_CHAT_ID;
    if (!token || !chatId) return;
    try {
        await sendText(token, chatId, `❌ ВЫГРУЗКА УПАЛА\nЧат ID: ${options.id}\nОшибка: ${err.message}`, getAgent());
    } catch (_) {}
}

module.exports = { notifyExportDone, notifyExportError };
