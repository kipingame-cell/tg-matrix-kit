let sid = localStorage.getItem('tg_sid');
let smartKeys = [];
let allChats = [];

const getEl = (id) => document.getElementById(id);

// --- КЭШ СОСТОЯНИЯ ТЕРМИНАЛА: держим список чатов, выбранный чат,
// --- результаты последней выгрузки и настройки формы между переходами
// --- на граф/радар и обратно. Сбрасывается только при релогине.
const cacheKey = (k) => `tgk_${sid}_${k}`;
const loadCache = (k) => { try { return JSON.parse(localStorage.getItem(cacheKey(k))); } catch (e) { return null; } };
const saveCacheData = (k, v) => { try { localStorage.setItem(cacheKey(k), JSON.stringify(v)); } catch (e) {} };
const clearAllCache = () => ['chats', 'sel', 'lastres', 'form'].forEach(k => localStorage.removeItem(cacheKey(k)));

async function apiCall(path, method = 'GET', data = null) {
    try {
        const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : null });
        if (res.status === 401) { location.reload(); return; }
        return await res.json();
    } catch (e) { return null; }
}

function loadKeys() {
    try { smartKeys = JSON.parse(localStorage.getItem('smart_ai_keys')) || [{type:'gemini', val:''}]; } catch(e) { smartKeys = [{type:'gemini', val:''}]; }
    renderKeys();
}

function renderKeys() {
    const cont = getEl('dynamic_keys_container');
    if (!cont) return;
    cont.innerHTML = '';
    smartKeys.forEach((k, i) => {
        const row = document.createElement('div'); row.className = 'dynamic-key-row';
        row.innerHTML = `<select onchange="saveKeys()"><option value="gemini" ${k.type==='gemini'?'selected':''}>Gemini</option><option value="gpt" ${k.type==='gpt'?'selected':''}>GPT</option></select>
        <input type="password" value="${k.val}" placeholder="КЛЮЧ..." onblur="saveKeys()">
        <button class="del-btn" onclick="removeKey(${i})">X</button>`;
        cont.appendChild(row);
    });
}
window.saveKeys = () => {
    const cont = getEl('dynamic_keys_container');
    if (!cont) return;
    smartKeys = Array.from(cont.querySelectorAll('.dynamic-key-row')).map(r => ({ type: r.querySelector('select').value, val: r.querySelector('input').value.trim() }));
    localStorage.setItem('smart_ai_keys', JSON.stringify(smartKeys));
};
window.removeKey = (i) => { smartKeys.splice(i, 1); renderKeys(); saveKeys(); };

// Динамическая кнопка повторной отправки кода (не требует правки HTML)
function showResendButton() {
    const codeBlock = getEl('code_block');
    if (!codeBlock) return;
    let rb = getEl('resend_code_btn');
    if (!rb) {
        rb = document.createElement('button');
        rb.id = 'resend_code_btn';
        rb.innerText = 'КОД НЕ ПРИШЁЛ? ВЫСЛАТЬ ПО SMS/ЗВОНКОМ';
        rb.style.cssText = 'margin-top:8px; width:100%; padding:8px; background:transparent; border:1px dashed #cc0000; color:#cc0000; font-size:10px; cursor:pointer; letter-spacing:1px;';
        rb.onclick = async (e) => {
            e.preventDefault();
            rb.disabled = true; rb.innerText = 'ПЕРЕОТПРАВКА...';
            const res = await apiCall('/api/tg/resend-code', 'POST', { sid });
            rb.disabled = false;
            if (res && res.success) {
                rb.innerText = 'ОТПРАВЛЕНО: ' + (res.deliveryType || 'ПОВТОР');
            } else {
                rb.innerText = 'СБОЙ: ' + ((res && res.error) || 'ПОПРОБУЙТЕ ПОЗЖЕ');
            }
            setTimeout(() => { rb.innerText = 'КОД НЕ ПРИШЁЛ? ВЫСЛАТЬ ПО SMS/ЗВОНКОМ'; }, 5000);
        };
        codeBlock.appendChild(rb);
    }
    rb.classList.remove('hidden');
}

if (getEl('btn_web_login')) {
    getEl('btn_web_login').onclick = async () => {
        const user = getEl('web_user').value.trim(), pass = getEl('web_pass').value.trim();
        if (user !== '' && pass !== '') {
            getEl('web_login_frame').classList.add('hidden');
            if (!sid) { sid = 'session_' + btoa(user + Date.now()).replace(/=/g, ''); localStorage.setItem('tg_sid', sid); }
            const check = await apiCall(`/api/tg/check?sid=${sid}`);
            if (check && check.active) window.initControl();
            else getEl('auth_frame').classList.remove('hidden');
        } else alert('ОШИБКА: ЗАПОЛНИТЕ ДАННЫЕ ВХОДА');
    };
}

if (getEl('connect_btn')) {
    getEl('connect_btn').onclick = async () => {
        const phone = getEl('phone').value.trim(), code = getEl('code').value.trim(), pwd = getEl('password').value.trim();
        const btn = getEl('connect_btn');
        try {
            if (pwd) {
                btn.innerText = "ПРОВЕРКА 2FA..."; btn.style.opacity = '0.5'; btn.disabled = true;
                const res = await apiCall('/api/tg/password', 'POST', { sid, password: pwd });
                btn.style.opacity = '1'; btn.disabled = false; btn.innerText = "УСТАНОВИТЬ СВЯЗЬ";
                if (res && res.success) { alert("СВЯЗЬ УСТАНОВЛЕНА!"); window.initControl(); }
                else alert("ОШИБКА 2FA: " + ((res && res.error) || 'НЕВЕРНЫЙ ПАРОЛЬ'));
                return;
            }
            if (code) {
                btn.innerText = "ПРОВЕРКА КОДА..."; btn.style.opacity = '0.5'; btn.disabled = true;
                const res = await apiCall('/api/tg/login', 'POST', { sid, code: code });
                btn.style.opacity = '1'; btn.disabled = false; btn.innerText = "ОТПРАВИТЬ КОД";
                if (res && res.requiresPassword) { getEl('code_block').classList.add('hidden'); getEl('password_block').classList.remove('hidden'); btn.innerText = "ОТПРАВИТЬ ПАРОЛЬ"; }
                else if (res && res.success) { alert("СВЯЗЬ УСТАНОВЛЕНА!"); window.initControl(); }
                else alert("ОШИБКА КОДА: " + ((res && res.error) || 'НЕВЕРНЫЙ КОД'));
                return;
            }
            if (phone) {
                btn.innerText = "ПОДКЛЮЧЕНИЕ... (ЖДИТЕ ДО 60 СЕК)"; btn.style.opacity = '0.5'; btn.disabled = true;
                const res = await apiCall('/api/tg/send-code', 'POST', { sid, phone });
                btn.style.opacity = '1'; btn.disabled = false;
                if (res && res.success) {
                    getEl('code_block').classList.remove('hidden');
                    btn.innerText = "ОТПРАВИТЬ КОД";
                    showResendButton();
                    alert("КОД ОТПРАВЛЕН. КАНАЛ: " + (res.deliveryType || 'TELEGRAM'));
                }
                else { alert("СБОЙ: " + ((res && res.error) || 'СЕРВЕР ОТКЛОНИЛ ЗАПРОС')); btn.innerText = "УСТАНОВИТЬ СВЯЗЬ"; }
            }
        } catch(e) { alert("СИСТЕМНАЯ ОШИБКА."); btn.style.opacity = '1'; btn.disabled = false; btn.innerText = "УСТАНОВИТЬ СВЯЗЬ"; }
    };
}

// Показ кнопок результатов выгрузки + запоминание (чтобы пережить уход на граф/радар)
function showResultButtons(r) {
    if (r.downloadUrl) { const btn = getEl('download_btn'); if (btn) { btn.classList.remove('hidden'); btn.onclick = () => window.location.href = r.downloadUrl; } }
    if (r.graph) { const gb = getEl('view_graph_btn'); if (gb) { gb.classList.remove('hidden'); gb.onclick = () => window.location.href = `/graph/?file=${encodeURIComponent(r.graph)}`; } }
    if (r.heatmap) { const hb = getEl('view_heatmap_btn'); if (hb) { hb.classList.remove('hidden'); hb.onclick = () => window.location.href = `/heatmap/?file=${encodeURIComponent(r.heatmap)}`; } }
    if (r.dossier) { const db = getEl('download_ai_btn'); if (db) { db.innerText = "ОТКРЫТЬ ДОСЬЕ"; db.classList.remove('hidden'); db.onclick = () => window.location.href = r.dossier; } }
    saveCacheData('lastres', r);
}

function connectStream() {
    if (window.exportEs) window.exportEs.close();
    window.exportEs = new EventSource(`/api/tg/export/stream?sid=${sid}`);
    window.exportEs.onmessage = (e) => {
        const d = JSON.parse(e.data);
        if (d.type === 'monitor_update') {
            if (d.log && getEl('mon_logs')) {
                const div = document.createElement('div'); div.textContent = `[${new Date().toLocaleTimeString()}] > ${d.log}`;
                div.style.borderBottom = '1px dashed #222'; div.style.paddingBottom = '3px'; div.style.marginBottom = '3px';
                getEl('mon_logs').appendChild(div); getEl('mon_logs').scrollTop = getEl('mon_logs').scrollHeight;
            }
            if (d.processed !== undefined && getEl('mon_speed')) getEl('mon_speed').innerText = d.processed;
            if (d.exported !== undefined && getEl('mon_exported')) getEl('mon_exported').innerText = d.exported;
            if (d.processed !== undefined && getEl('mon_processed')) getEl('mon_processed').innerText = `${d.processed} / ${d.total}`;
            if (d.percent !== undefined && getEl('mon_progress')) getEl('mon_progress').style.width = `${d.percent}%`;
        }
        if (d.type === 'archive_ready') {
            showResultButtons({ downloadUrl: d.downloadUrl, graph: d.extras?.graph, heatmap: d.extras?.heatmap, dossier: d.extras?.dossier });
        }
        if (d.type === 'done' || d.type === 'error') {
            if (d.type === 'error' && getEl('mon_logs')) { const div = document.createElement('div'); div.textContent = `[${new Date().toLocaleTimeString()}] > ОШИБКА: ${d.msg}`; div.style.color = '#cc0000'; getEl('mon_logs').appendChild(div); }
            window.exportEs.close(); getEl('export_btn')?.classList.remove('hidden'); getEl('stop_btn')?.classList.add('hidden');
        }
    };
}

// Сканирование базы чатов (ручное или при первом входе)
async function scanChats(silent = false) {
    const list = getEl('chat_list');
    if (!silent && list) list.innerHTML = '<div style="color: #aaa; font-size: 10px; text-align: center; padding: 15px;">СКАНИРОВАНИЕ СЕТИ...</div>';
    const data = await apiCall(`/api/tg/chats?sid=${sid}`);
    if (data && data.success && data.chats) {
        allChats = data.chats;
        window.renderChats();
        saveCacheData('chats', allChats);
        // Восстановить выделение после перерисовки
        const sel = loadCache('sel');
        if (sel && sel.id) {
            const item = getEl('chat-item-' + sel.id);
            if (item) { item.style.background = '#1a1a24'; item.style.borderLeft = '3px solid #cc0000'; }
        }
        return true;
    }
    if (!silent && list) list.innerHTML = '<div style="color: #c00; font-size: 10px; text-align: center; padding: 15px;">ОШИБКА БАЗЫ. НУЖЕН РЕЛОГИН.</div>';
    return false;
}

// Восстановление настроек формы выгрузки
function restoreForm() {
    const f = loadCache('form');
    if (!f) return;
    const set = (id, v) => { const el = getEl(id); if (el && v !== undefined && v !== null) el.value = v; };
    const setChk = (id, v) => { const el = getEl(id); if (el && v !== undefined) el.checked = !!v; };
    set('keywords', f.keywords); set('limit', f.limit); set('exportMode', f.exportMode);
    set('dateFrom', f.dateFromRaw); set('dateTo', f.dateToRaw);
    setChk('buildGraph', f.buildGraph); setChk('buildDossier', f.buildDossier);
    setChk('buildHeatmap', f.buildHeatmap); setChk('downloadMedia', f.downloadMedia);
}

window.initControl = async () => {
    getEl('web_login_frame')?.classList.add('hidden');
    getEl('auth_frame')?.classList.add('hidden');
    getEl('control_frame')?.classList.remove('hidden'); loadKeys();
    restoreForm();

    if (getEl('btn_toggle_keys_panel')) getEl('btn_toggle_keys_panel').onclick = () => getEl('keys_panel').classList.toggle('hidden');
    if (getEl('btn_add_dynamic_key')) getEl('btn_add_dynamic_key').onclick = () => { smartKeys.push({type:'gemini', val:''}); renderKeys(); saveKeys(); };
    if (getEl('btn_logout_control')) getEl('btn_logout_control').onclick = () => { clearAllCache(); localStorage.removeItem('tg_sid'); location.reload(); };
    if (getEl('btn_rescan')) getEl('btn_rescan').onclick = () => scanChats(false);

    const taskStatus = await apiCall(`/api/tg/export/status?sid=${sid}`);
    if (taskStatus && taskStatus.active) {
        getEl('cyber_monitor')?.classList.remove('hidden');
        getEl('export_btn')?.classList.add('hidden');
        getEl('stop_btn')?.classList.remove('hidden');
        connectStream();
    } else {
        // Выгрузка не идёт — вернуть кнопки результатов прошлого запуска
        const lastRes = loadCache('lastres');
        if (lastRes) showResultButtons(lastRes);
    }

    // База чатов: сначала мгновенно из кэша, потом тихое обновление в фоне
    const cachedChats = loadCache('chats');
    if (cachedChats && cachedChats.length) {
        allChats = cachedChats;
        window.renderChats();
        // Восстановить выбранный объект (подтянет ветки и участников)
        const sel = loadCache('sel');
        if (sel && sel.id && sel.name) {
            getEl('dialogs_dropdown').value = sel.id;
            getEl('selected_chat_display').innerText = 'ВЫБРАН: ' + sel.name;
            const item = getEl('chat-item-' + sel.id);
            if (item) { item.style.background = '#1a1a24'; item.style.borderLeft = '3px solid #cc0000'; }
            window.selectChat(sel.id, sel.name);
        }
        scanChats(true); // фоновое обновление без мигания
    } else {
        await scanChats(false);
    }
};

window.selectChat = (id, name) => {
    getEl('dialogs_dropdown').value = id; getEl('selected_chat_display').innerText = 'ВЫБРАН: ' + name;
    saveCacheData('sel', { id, name });
    document.querySelectorAll('.chat-item').forEach(el => { el.style.background = 'transparent'; el.style.borderLeft = '3px solid transparent'; });
    const active = getEl('chat-item-' + id); if(active) { active.style.background = '#1a1a24'; active.style.borderLeft = '3px solid #cc0000'; }

    const tDrop = getEl('topics_dropdown'), tGroup = getEl('topic_group');
    if (tDrop && tGroup) {
        tDrop.innerHTML = '<option value="">СКАНИРОВАНИЕ ВЕТОК...</option>';
        apiCall('/api/tg/topics?sid=' + sid + '&id=' + id).then(tRes => {
            if(tRes && tRes.success && tRes.topics && tRes.topics.length > 0) {
                tGroup.classList.remove('hidden'); tDrop.innerHTML = '<option value="">ВСЕ ВЕТКИ</option>' + tRes.topics.map(t => `<option value="${t.id}">${t.title}</option>`).join('');
            } else { tGroup.classList.add('hidden'); tDrop.innerHTML = ''; }
        }).catch(() => tGroup.classList.add('hidden'));
    }

    const uDrop = getEl('fromUser');
    if (uDrop) {
        uDrop.innerHTML = '<option value="">ОНЛАЙН СКАНИРОВАНИЕ...</option>';
        if (window.partStream) window.partStream.close();
        let foundCount = 0; window.partStream = new EventSource(`/api/tg/participants-stream?sid=${sid}&id=${id}`);
        window.partStream.onmessage = (e) => {
            const data = JSON.parse(e.data);
            if (data.ping) return;
            if (data.done || data.error) { window.partStream.close(); if(foundCount === 0) uDrop.innerHTML = '<option value="">УЧАСТНИКИ НЕ НАЙДЕНЫ</option>'; return; }
            if (data.id && data.name) {
                foundCount++; if (foundCount === 1) uDrop.innerHTML = '<option value="">ВСЕ УЧАСТНИКИ (1)</option>'; else uDrop.options[0].text = `ВСЕ УЧАСТНИКИ (${foundCount})`;
                const opt = document.createElement('option'); opt.value = data.id; opt.text = data.name; uDrop.appendChild(opt);
            }
        };
    }
};

window.renderChats = () => {
    const query = getEl('chat_search')?.value.toLowerCase() || '', sort = getEl('chat_sort')?.value || 'az', list = getEl('chat_list');
    if (!list) return;
    let filtered = allChats.filter(c => c.name.toLowerCase().includes(query));
    filtered.sort((a, b) => sort === 'az' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name));
    if (filtered.length === 0) { list.innerHTML = '<div style="color:#5a5a5f;font-size:10px;text-align:center;padding:15px;">СОВПАДЕНИЙ НЕ НАЙДЕНО</div>'; return; }
    list.innerHTML = '';
    filtered.forEach(c => {
        const div = document.createElement('div'); div.id = 'chat-item-' + c.id; div.className = 'chat-item';
        div.style.cssText = 'cursor:pointer; padding:10px; border-bottom:1px solid #111; border-left:3px solid transparent; font-size:12px; color:#aaa; transition:0.2s; word-break: break-word;';
        div.onmouseover = () => div.style.color = '#fff'; div.onmouseout = () => div.style.color = '#aaa';
        div.textContent = c.name; div.onclick = () => window.selectChat(c.id, c.name); list.appendChild(div);
    });
};

if(getEl('chat_search')) getEl('chat_search').addEventListener('input', window.renderChats);
if(getEl('chat_sort')) getEl('chat_sort').addEventListener('change', window.renderChats);

if (getEl('export_btn')) {
    getEl('export_btn').onclick = async () => {
        const chatId = getEl('dialogs_dropdown')?.value;
        if (!chatId) return alert("ОБЪЕКТ НЕ ВЫБРАН");
        saveKeys();
        getEl('cyber_monitor')?.classList.remove('hidden'); getEl('export_btn')?.classList.add('hidden'); getEl('stop_btn')?.classList.remove('hidden');
        if(getEl('mon_logs')) getEl('mon_logs').innerHTML = '';
        ['download_btn', 'view_graph_btn', 'view_heatmap_btn', 'download_ai_btn'].forEach(id => { const btn = getEl(id); if (btn) btn.classList.add('hidden'); });
        localStorage.removeItem(cacheKey('lastres'));

        const df = getEl('dateFrom')?.value, dt = getEl('dateTo')?.value, limValue = getEl('limit')?.value.trim();
        const params = {
            sid: sid, id: chatId, limit: limValue,
            keywords: getEl('keywords')?.value || '', topicId: getEl('topics_dropdown')?.value || '', fromUser: getEl('fromUser')?.value || '',
            dateFrom: df ? new Date(df).getTime() : '', dateTo: dt ? new Date(dt).getTime() : '',
            buildGraph: getEl('buildGraph')?.checked || false, buildDossier: getEl('buildDossier')?.checked || false,
            buildHeatmap: getEl('buildHeatmap')?.checked || false, downloadMedia: getEl('downloadMedia')?.checked || false,
            exportMode: getEl('exportMode')?.value || 'all', aiKeys: smartKeys.map(k => k.val).filter(Boolean).join(',')
        };

        // Запомнить форму, чтобы вернуть её при возврате на страницу
        saveCacheData('form', {
            keywords: params.keywords, limit: limValue, exportMode: params.exportMode,
            dateFromRaw: df || '', dateToRaw: dt || '',
            buildGraph: params.buildGraph, buildDossier: params.buildDossier,
            buildHeatmap: params.buildHeatmap, downloadMedia: params.downloadMedia
        });

        await apiCall('/api/tg/export/start', 'POST', params);
        connectStream();
    };
}

if (getEl('stop_btn')) {
    getEl('stop_btn').onclick = async () => {
        await apiCall('/api/tg/export/stop', 'POST', { sid });
    };
}

// --- АВТОВХОД: сессия уже есть на сервере → сразу в панель управления, без окон логина ---
(async () => {
    if (!sid) return;
    const check = await apiCall(`/api/tg/check?sid=${sid}`);
    if (check && check.active) {
        window.initControl();
    }
})();
