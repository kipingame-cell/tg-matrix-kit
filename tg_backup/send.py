"""Отправка тяжёлых файлов в Telegram через MTProto (Pyrogram).
Секреты — только из окружения. См. .env.example в корне репо.
"""
import os
import sys
import time

from pyrogram import Client

API_ID = int(os.environ["TG_API_ID"])
API_HASH = os.environ["TG_API_HASH"]
BOT_TOKEN = os.environ["TG_BOT_TOKEN"]
CHAT_ID = int(os.environ["TG_CHAT_ID"])
USE_PROXY = os.environ.get("USE_TOR", "0") == "1"

proxy = dict(scheme="socks5", hostname="127.0.0.1", port=9050) if USE_PROXY else None

app = Client(
    "bot_session",
    api_id=API_ID,
    api_hash=API_HASH,
    bot_token=BOT_TOKEN,
    proxy=proxy,
    ipv6=False,
)


async def main():
    async with app:
        for file_path in sys.argv[1:]:
            print(f"[TG] Тяжелый файл. Отправка {file_path} через MTProto...")
            await app.send_document(chat_id=CHAT_ID, document=file_path)
            time.sleep(3)


app.run(main())
