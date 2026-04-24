FROM node:24.15.0

WORKDIR /app

COPY ./package*.json ./

RUN npm i

COPY ./ ./

CMD ["node", "index.js"]
