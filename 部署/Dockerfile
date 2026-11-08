FROM python:3.11-slim
WORKDIR /app
COPY 部署/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY . /app
EXPOSE 7860
CMD ["uvicorn", "部署.server:app", "--host", "0.0.0.0", "--port", "7860"]
