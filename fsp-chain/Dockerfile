FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Start all 4 nodes simultaneously
CMD ["node", "start-all.js"]