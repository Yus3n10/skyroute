# Two stages: build the frontend with Node, then serve everything from Python.
# The result is one container with one port - the API and the built UI together,
# so there is no CORS configuration and no second service to keep alive.

FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.11-slim
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY api/ ./api/
COPY seed/ ./seed/
COPY --from=web /web/dist ./web/dist

# Don't run the app as root.
RUN useradd --create-home --uid 10001 app && chown -R app:app /app
USER app

ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn api.main:app --host 0.0.0.0 --port ${PORT}"]
