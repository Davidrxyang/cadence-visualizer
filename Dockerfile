# Stage 1: build the React app
FROM node:20-slim AS frontend
WORKDIR /app
COPY app/package*.json ./
RUN npm ci
COPY app/ ./
RUN npm run build

# Stage 2: runtime
FROM python:3.12-slim
WORKDIR /app

COPY server/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY server/ ./server/
COPY db/ ./db/
COPY messages/ ./messages/
COPY --from=frontend /app/dist ./app/dist/

EXPOSE 7860

CMD ["uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "7860"]
