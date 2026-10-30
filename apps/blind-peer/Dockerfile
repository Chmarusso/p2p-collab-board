# Always-on blind peer for OpenCollab boards. Keep /data on a volume: the
# peer's key comes from it. Run with host networking (or publish the UDP port).
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
ENV NODE_ENV=production
VOLUME /data
ENTRYPOINT ["/app/node_modules/.bin/blind-peer", "--storage", "/data/storage"]
CMD ["--port", "49737", "--max-storage", "20000"]
