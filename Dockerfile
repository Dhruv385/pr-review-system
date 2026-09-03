FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY prisma ./prisma
COPY src ./src

RUN npx prisma generate && npm run build

EXPOSE 3000

CMD ["node", "dist/main.js"]
