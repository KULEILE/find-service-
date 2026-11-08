FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3001 3002 3003 3004

CMD ["node", "node/index.js", "1", "3001"]