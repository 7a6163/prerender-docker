FROM node:22-alpine

RUN apk add --no-cache tini chromium

WORKDIR "/app"
COPY ./package.json .
COPY ./server.js .
RUN npm install --no-package-lock

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
