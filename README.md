# TG Matrix Kit

Приватный набор TG-инструментов, перенесённый из `site/matrix_v2`:

1. **`/tg/` — Терминал «Матрица»** — веб-выгрузчик чатов Telegram (GramJS юзербот):
   вход по телефону/коду/2FA → выбор чата → фильтры (ключевые слова, участник, даты, топик, лимит, медиа) → архив ZIP (TXT + HTML + JSON + превью фото) + аналитика: **граф связей** (`/graph/`), **тепловая карта активности** (`/heatmap/`), **ИИ-досье** через Gemini.
2. **`tg_backup/`** — серверный бэкап PostgreSQL → Telegram (дамп всех баз, нарезка по 1900 МБ, отправка ботом: мелкое через Bot API, крупное через MTProto/Pyrogram).

## Запуск терминала локально

```bash
npm install
cp .env.example .env   # заполни SESSION_SECRET (и TELEGRAM_API_ID/HASH при желании)
npm start
```

Открыть: **http://localhost:3000/tg/**

- USER_ID/PASSWORD на первом экране — произвольные (это локальный sid сессии, а не реальная авторизация).
- Дальше вход в Telegram: телефон → код из приложения → 2FA-пароль (если включён).
- Сессии шифруются AES-256 ключом от `sid` + `SESSION_SECRET` и лежат в `tg_sessions/` (в .gitignore).
- `USE_TOR=1` — гнать MTProto и запросы к Google через Tor (`tor` должен быть запущен на 127.0.0.1:9050). Полезно, если провайдер режет Telegram/Google.

## tg_backup (на сервере)

```bash
cd tg_backup
python3 -m venv venv && ./venv/bin/pip install -r requirements.txt
export TG_BOT_TOKEN=... TG_CHAT_ID=... TG_API_ID=... TG_API_HASH=...
./backup.sh
```

## Что исправлено при переносе

- Роутер `tg_export.js` (`/participants-stream`, `/download-extra`) в исходнике не был смонтирован — список участников и скачивание архива падали. Смонтирован.
- Роут `/api/tg/topics` отсутствовал совсем — выбор ветки форума не работал. Добавлен (`channels.GetForumTopics`).
- Tor-прокси был захардкожен — без запущенного Tor локально ничего не коннектилось. Теперь `USE_TOR=0/1`.
- Токен бота и api_id/hash были в коде открытым текстом в публичном репо — вынесены в `.env`.
- `download-extra` — добавлена защита от path traversal.

## ⚠️ Безопасность

Старый публичный репо `site` содержал: токен бота, `bot_session.session`, реальные ключи в `.env.example` (Telegram API hash, Gemini key, admin token). Всё это скомпрометировано — **отзови токен у @BotFather (`/revoke`), смени Gemini-ключ и сессии**, а из `site` удали секреты из истории git (или сделай репо приватным).
