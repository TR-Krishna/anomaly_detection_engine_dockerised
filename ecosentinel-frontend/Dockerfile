FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . . 
ENV VITE_API_BASE_URL=/api-proxy
EXPOSE 5173
CMD ["npm","run","dev","--","--host","0.0.0.0"]
