# Containerization of the Prerender Service

This repository contains the configuration and setup to containerize the Prerender service using Docker. The service leverages prerender and prerender-memory-cache to render JavaScript content for web crawlers.

## Prerequisites

Ensure you have Docker installed on your system. You can download it from [here](https://www.docker.com/).

## Usage

Pull and run the image:

```
docker pull ghcr.io/7a6163/prerender
docker run -p 3000:3000 ghcr.io/7a6163/prerender
```

To use the Prerender service, access it on localhost at port 3000 and check a URL by using curl:
```
curl http://localhost:3000/render?url=https://www.google.com/
```
