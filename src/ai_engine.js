/**
 * TG Matrix Kit — ИИ-профайлинг участников через Gemini.
 * Перенесено из site/matrix_v2 (packages/modules/telegram/src/ai_engine.js).
 * Изменение: Tor-прокси для запросов к Google опционален (USE_TOR=1).
 */

const fetch = require('node-fetch');
const USE_TOR = process.env.USE_TOR === '1';
let torAgent;
if (USE_TOR) {
    const { SocksProxyAgent } = require('socks-proxy-agent');
    torAgent = new SocksProxyAgent('socks5h://127.0.0.1:9050');
}

function generateDossierHtml(aiText, modelName, isFallback = false) {
    let cleanText = aiText.replace(/```html/gi, '').replace(/```/g, '').trim();
    return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <title>ПРОФАЙЛИНГ // ОБЪЕКТЫ</title>
    <style>
        body { background: #0a0a0a; color: #e0e0e0; font-family: 'JetBrains Mono', monospace; padding: 20px; }
        .dossier-container { max-width: 900px; margin: 0 auto; border: 2px solid #b71c1c; padding: 4px; background: #111; box-shadow: 0 0 15px rgba(183,28,28,0.2); }
        .dossier-inner { border: 1px solid #333; padding: 20px; background: repeating-linear-gradient(0deg, #111, #111 2px, #151515 2px, #151515 4px); }
        .ah-title { color: #b71c1c; text-transform: uppercase; font-size: 20px; text-align: center; letter-spacing: 4px; border-bottom: 2px solid #b71c1c; padding-bottom: 10px; margin-top: 0; }
        .target-card { background: rgba(20, 20, 20, 0.95); border-left: 4px solid #b71c1c; border-right: 1px solid #333; border-top: 1px solid #333; border-bottom: 1px solid #333; margin-bottom: 20px; padding: 20px; transition: 0.2s; box-shadow: inset 0 0 10px rgba(0,0,0,0.5); }
        .target-card:hover { border-left-color: #fbc02d; background: #161616; box-shadow: inset 0 0 20px rgba(251,192,45,0.05); }
        .name { color: #fbc02d; font-size: 1.5em; font-weight: bold; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 15px; border-bottom: 1px dashed #555; padding-bottom: 5px; }
        .section-title { color: #b71c1c; font-size: 1.1em; margin-top: 20px; margin-bottom: 10px; text-transform: uppercase; border-bottom: 1px solid #333; padding-bottom: 3px; font-weight: bold; }
        .param-row { display: flex; margin-bottom: 8px; font-size: 13px; line-height: 1.4; border-bottom: 1px solid rgba(255,255,255,0.02); padding-bottom: 4px;}
        .param-label { color: #777; width: 180px; flex-shrink: 0; text-transform: uppercase; }
        .param-value { color: #d0d0d0; }
        .engine-tag { color: #fbc02d; font-size: 10px; text-align: right; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 20px; }
        ul { margin: 5px 0 15px 0; padding-left: 20px; color: #d0d0d0; font-size: 13px; }
        li { margin-bottom: 4px; }
    </style>
</head>
<body>
    <div class="dossier-container">
        <div class="dossier-inner">
            <div class="engine-tag">[ДВИЖОК АНАЛИТИКИ: ${modelName}${isFallback ? ' / РЕЗЕРВ' : ''}]</div>
            <h2 class="ah-title">ГЛУБОКОЕ ПРОФИЛИРОВАНИЕ ОБЪЕКТОВ</h2>
            ${cleanText}
        </div>
    </div>
</body>
</html>`;
}

async function buildDeepProfile(apiKey, userQuotesMap, progressCallback) {
    try {
        progressCallback({ log: '[ИИ] Пинг серверов Google...' });

        const modelsRes = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + apiKey.trim(), { agent: torAgent });
        if (!modelsRes.ok) {
            const errText = await modelsRes.text();
            return `ОШИБКА КЛЮЧА (${modelsRes.status}): ${errText}`;
        }

        const modelsData = await modelsRes.json();
        const validModels = modelsData.models.filter(m =>
            m.supportedGenerationMethods &&
            m.supportedGenerationMethods.includes('generateContent') &&
            m.name.includes('gemini')
        );

        if (validModels.length === 0) return 'ОШИБКА: На вашем ключе нет доступных моделей Gemini.';

        let bestModel = null;
        let highestVer = 0;

        validModels.forEach(m => {
            if (m.name.includes('flash')) {
                const match = m.name.match(/gemini-([0-9]+\.[0-9]+)/);
                if (match) {
                    const ver = parseFloat(match[1]);
                    if (ver > highestVer) { highestVer = ver; bestModel = m; }
                }
            }
        });

        if (!bestModel) bestModel = validModels[0];
        const finalModelName = bestModel.name.replace('models/', '');
        progressCallback({ log: `[ИИ] Успех. Выбран движок: ${finalModelName}` });

        const top = Array.from(userQuotesMap.entries()).sort((a, b) => b[1].length - a[1].length).slice(0, 10);
        let prompt = `Ты ИИ системы 'Предприятие 3826'. Проведи глубокий психологический профайлинг следующих объектов на основе их цитат.
Стиль: технологичный, научный, сухой. Исключи любой советский пафос (никаких рабочих и крестьян), используй термины 'Объект', 'Данные', 'Паттерны'.

Для КАЖДОГО объекта строго используй эту HTML-структуру (не используй Markdown \`\`\`html):
<div class="target-card">
    <div class="name">ОБЪЕКТ: ИМЯ</div>

    <div class="section-title">1. Биография и статус</div>
    <ul>
        <li>Факт 1</li>
        <li>Факт 2</li>
    </ul>

    <div class="section-title">2. Метапрограммы</div>
    <div class="param-row"><div class="param-label">Мотивация:</div><div class="param-value">...</div></div>
    <div class="param-row"><div class="param-label">Референция:</div><div class="param-value">...</div></div>
    <div class="param-row"><div class="param-label">Сортировка:</div><div class="param-value">...</div></div>
    <div class="param-row"><div class="param-label">Фокус времени:</div><div class="param-value">...</div></div>
    <div class="param-row"><div class="param-label">Активность:</div><div class="param-value">...</div></div>
    <div class="param-row"><div class="param-label">Фрейм:</div><div class="param-value">...</div></div>

    <div class="section-title">3. Стресс-факторы</div>
    <div class="param-row"><div class="param-label">Триггеры:</div><div class="param-value">...</div></div>
    <div class="param-row"><div class="param-label">Реакции:</div><div class="param-value">...</div></div>
    <div class="param-row"><div class="param-label">Копинг-стратегии:</div><div class="param-value">...</div></div>

    <div class="section-title">4. Роль в системе</div>
    <div class="param-row"><div class="param-label">Классификация:</div><div class="param-value">...</div></div>
</div>

ДАННЫЕ ДЛЯ АНАЛИЗА:\n`;

        top.forEach(([n, c]) => prompt += `ОБЪЕКТ: ${n}, ДАННЫЕ (ЦИТАТЫ): ${c.join(' | ')}\n`);

        const makeReq = async (modelObj) => fetch(`https://generativelanguage.googleapis.com/v1beta/${modelObj.name}:generateContent?key=${apiKey.trim()}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
            agent: torAgent
        });

        const res = await makeReq(bestModel);

        if (!res.ok) {
            if (res.status === 429) {
                progressCallback({ log: `[ИИ] Лимит квоты (429) на ${finalModelName}. Переход на резервный Flash...` });
                let fallbackModel = validModels.find(m => (m.name.includes('gemini-2.5-flash') || m.name.includes('gemini-2.0-flash') || m.name.includes('gemini-1.5-flash')) && m.name !== bestModel.name);
                if (!fallbackModel) fallbackModel = validModels.find(m => m.name.includes('flash') && m.name !== bestModel.name);

                if (fallbackModel) {
                    const fallbackName = fallbackModel.name.replace('models/', '');
                    progressCallback({ log: `[ИИ] Резервный запуск через: ${fallbackName}` });
                    const fallbackRes = await makeReq(fallbackModel);

                    if (fallbackRes.ok) {
                        const data = await fallbackRes.json();
                        const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Пустой ответ от ИИ.';
                        return generateDossierHtml(aiText, fallbackName, true);
                    } else {
                        const errText = await fallbackRes.text();
                        return `ОШИБКА ${fallbackRes.status} (${fallbackName}).<br><br>Ответ резервного сервера:<br>${errText}`;
                    }
                }
            }
            const errText = await res.text();
            return `ОШИБКА ${res.status} (${finalModelName}).<br><br>Ответ серверов Google:<br>${errText}`;
        }

        const data = await res.json();
        const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Пустой ответ от ИИ.';
        return generateDossierHtml(aiText, finalModelName, false);

    } catch (e) { return 'СЕТЕВАЯ ОШИБКА: ' + e.message; }
}

module.exports = { buildDeepProfile };
