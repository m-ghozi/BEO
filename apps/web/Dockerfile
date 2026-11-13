FROM docker.io/library/node:22-alpine AS builder

WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm ci --workspace=@beo/contracts --workspace=@beo/web --include-workspace-root=false || npm install --workspace=@beo/contracts --workspace=@beo/web

COPY packages/contracts packages/contracts
COPY apps/web apps/web

ARG VITE_API_BASE_URL=http://localhost:8080
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm run build --workspace=@beo/web

FROM docker.io/library/nginx:alpine

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/apps/web/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
