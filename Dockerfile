FROM node:20-alpine

WORKDIR /app

# Только продакшн-зависимости; --ignore-scripts чтобы не собирать нативные модули (bufferutil)
COPY package*.json ./
RUN npm install --omit=dev --ignore-scripts

COPY . .

# Сессии и выгрузки живут вне образа: монтируй тома
#   -v $(pwd)/tg_sessions:/app/tg_sessions
#   -v $(pwd)/exports:/app/exports
RUN mkdir -p /app/tg_sessions /app/exports

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
