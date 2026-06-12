FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update -y && \
    apt-get install -y openssl wget curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm ci

COPY . .

RUN npx prisma generate

RUN npm run build

EXPOSE 3000

CMD ["node", "dist/src/server.js"]
