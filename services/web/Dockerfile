FROM node:20-alpine AS build
WORKDIR /app

ARG VITE_API_URL=/api
ARG VITE_WS_URL=/ws
ARG VITE_GOOGLE_MAPS_API_KEY=""
ENV VITE_API_URL=$VITE_API_URL \
    VITE_WS_URL=$VITE_WS_URL \
    VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund --legacy-peer-deps

COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK CMD wget -qO- http://localhost/ || exit 1
