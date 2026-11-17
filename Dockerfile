FROM node:22-bookworm-slim AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm test && npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HOST=0.0.0.0 PORT=8080
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir --requirement requirements.txt
COPY . ./
COPY --from=frontend /src/web ./web
RUN useradd --create-home --uid 10001 appuser && mkdir -p /var/data && chown -R appuser:appuser /app /var/data
USER appuser
EXPOSE 8080
CMD ["python", "standalone.py"]
