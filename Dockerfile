FROM node:26-alpine

RUN apk add --no-cache tini chromium

WORKDIR "/app"
# Dependencies first: editing server.js must not invalidate the install layer
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js url-normalize.js ./

EXPOSE 3000

LABEL org.opencontainers.image.description="Containerization of the Prerender Service"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
