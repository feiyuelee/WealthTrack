FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir --retries 10 --timeout 120 -r requirements.txt

COPY backend.py index.html app.js styles.css ./

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "backend:app", "--host", "0.0.0.0", "--port", "8000"]
