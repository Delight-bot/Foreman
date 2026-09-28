FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Next bakes the /api rewrite destination at build time, so the API URL must be present now
# (Railway passes service variables to Dockerfile builds as build args). Falls back to
# localhost for local `docker build`, which docker-compose overrides at runtime anyway.
ARG FOREMAN_API_URL
ENV FOREMAN_API_URL=$FOREMAN_API_URL
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/.next ./.next
COPY --from=build /app/next.config.ts ./
EXPOSE 3001
CMD ["npm", "start"]
