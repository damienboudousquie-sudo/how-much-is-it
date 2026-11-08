# how much is it ? — image for a small VPS (Netcup, Hetzner…)
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

# Dependencies first so they are cached between updates.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --include=dev

COPY . .
RUN npm run build -w web

ENV PORT=3001 HOST=0.0.0.0
EXPOSE 3001
# Pattern profiles and pp bands survive restarts here.
VOLUME ["/app/cache"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
