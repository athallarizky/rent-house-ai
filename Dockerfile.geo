FROM node:22-alpine

WORKDIR /app

COPY services/geo-router/package.json services/geo-router/package-lock.json* ./
RUN npm install && npm cache clean --force

COPY services/geo-router/tsconfig.json ./
COPY services/geo-router/src/ ./src/
COPY services/geo-router/kodepos/data/kodepos.json ./kodepos/data/kodepos.json

ENV PORT=3001

EXPOSE 3001

CMD ["npx", "tsx", "src/server.ts"]
