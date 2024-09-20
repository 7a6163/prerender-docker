FROM node:16-alpine

RUN apk add --no-cache tini chromium

WORKDIR "/app"
COPY ./package.json .
COPY ./server.js .
RUN npm install --no-package-lock

EXPOSE 3000

LABEL org.opencontainers.image.description="Containerization of the Prerender Service"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
