FROM node:22-slim

WORKDIR /app

COPY package.json tsconfig.json ./
RUN npm install --omit=dev=false

COPY src ./src

ENV NODE_ENV=production

CMD ["npx", "tsx", "src/index.ts", "start"]
