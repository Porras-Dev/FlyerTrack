FROM node:20-alpine
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --production
COPY backend/ .
COPY frontend/ /app/frontend
RUN mkdir -p assets/logos temp
EXPOSE 3000
CMD ["node", "src/index.js"]