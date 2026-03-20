FROM python:3.12-slim
WORKDIR /app
ENV PYTHONPATH=/app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
# Run tests — build fails if any test fails
# Dummy env vars satisfy pydantic-settings validation without a real DB/secrets
RUN DATABASE_URL=postgresql://test:test@localhost/test \
    SECRET_KEY=testsecret \
    GARAGE61_CLIENT_ID=test \
    GARAGE61_CLIENT_SECRET=test \
    ENCRYPTION_KEY=dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdA== \
    python -m pytest tests/ -v --tb=short
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
