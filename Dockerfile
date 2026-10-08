# Self-hosted be_game: the same http + ws server as the Vercel functions (src/local.ts), run with tsx.
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# tsx is a devDependency but runs the server, so install everything.
COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY tsconfig.json ./
COPY src ./src

ENV PORT=4000 HOST=0.0.0.0
EXPOSE 4000
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# Exec form so SIGTERM reaches node (graceful shutdown in src/local.ts).
CMD ["node_modules/.bin/tsx", "src/local.ts"]
