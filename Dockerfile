# DevSelfTrace annotation server in a container: serves the annotation page and saves the
# annotations to a JSON file in /app/data. Mount a folder there to keep them:
#
#   docker build -t devselftrace .
#   docker run --rm -p 8080:8080 -v "$PWD/data:/app/data" devselftrace
#   # then open http://localhost:8080/ ; annotations are saved to ./data/session.json
#
# Other options go after the image name, e.g. another file and label set:
#   docker run --rm -p 8080:8080 -v "$PWD/data:/app/data" devselftrace -p data/p01.json --create -l labels/cups.json
FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app_study/ app_study/
COPY labels/ labels/

VOLUME /app/data
EXPOSE 8080

ENTRYPOINT ["python", "app_study/server.py", "--host", "0.0.0.0", "--port", "8080"]
CMD ["-p", "data/session.json", "--create"]
