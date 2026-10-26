# brewpage-mcp image; build context = mcp-server/. Default CMD = stdio (catalogs).
# Remote Streamable HTTP: command ["node", "dist/http.js"], port 8787, see README "Remote HTTP mode".
FROM node:24.22.1-alpine3.24 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24.22.1-alpine3.24
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8787
CMD ["node", "dist/index.js"]
