# syntax=docker/dockerfile:1

# Build stage: install dependencies and produce the static bundle
FROM node:20-alpine AS build
WORKDIR /app

# Copy package manifests and install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the source and build for production
COPY . .
RUN npm run build

# Runtime stage: serve the built assets with nginx
FROM nginx:1.27-alpine AS runtime

# Copy custom nginx config to provide SPA routing fallbacks
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

# Copy the built site from the build stage into the nginx web root
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
