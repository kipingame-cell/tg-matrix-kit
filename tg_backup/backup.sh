#!/bin/bash
# Бэкап PostgreSQL → Telegram. Секреты берутся из окружения (см. .env.example).
set -euo pipefail

BASE_DIR="${TG_BACKUP_DIR:-$HOME/tg_backup}"
TMP_DIR="$BASE_DIR/tmp"
BOT_TOKEN="${TG_BOT_TOKEN:?Задай TG_BOT_TOKEN в окружении}"
CHAT_ID="${TG_CHAT_ID:?Задай TG_CHAT_ID в окружении}"
PROXY_URL="${TG_PROXY:-socks5h://127.0.0.1:9050}"

mkdir -p "$TMP_DIR"
rm -f "$TMP_DIR"/*

DATE=$(date +'%Y-%m-%d_%H-%M')
ARCHIVE="$TMP_DIR/db_clean_$DATE.sql.gz"

echo "[+] Сбор чистых данных (без системных каталогов и ролей)..."
DATABASES=$(sudo -u postgres psql -t -c "SELECT datname FROM pg_database WHERE datistemplate = false;")

for DB in $DATABASES; do
    echo " -> Дамп базы: $DB"
    sudo -u postgres pg_dump -d "$DB" -O -x --clean >> "$TMP_DIR/temp.sql"
done

cat "$TMP_DIR/temp.sql" | gzip > "$ARCHIVE"
rm -f "$TMP_DIR/temp.sql"

echo "[+] Нарезка архива на тома по 1900 МБ..."
cd "$TMP_DIR"
split -b 1900M "$ARCHIVE" "part_"
rm -f "$ARCHIVE"

echo "[+] Отправка кусков..."
cd "$BASE_DIR"
for part in tmp/part_*; do
    NEW_NAME="${part}_$DATE.sql.gz"
    mv "$part" "$NEW_NAME"

    FILE_SIZE=$(stat -c%s "$NEW_NAME")
    if [ "$FILE_SIZE" -lt 50000000 ]; then
        echo "[TG] Размер < 50 МБ. HTTP API через прокси..."
        curl -s -x "$PROXY_URL" -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendDocument" \
            -F chat_id="$CHAT_ID" \
            -F document=@"$NEW_NAME" > /dev/null
    else
        echo "[TG] Размер > 50 МБ. MTProto..."
        python3 send.py "$NEW_NAME"
    fi
done

rm -f "$TMP_DIR"/*
echo "[+] Бэкап успешно завершен."
