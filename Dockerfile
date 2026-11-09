FROM node:20-bookworm

# Install Python 3, pip, curl, git, build essentials, jq, bash
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    bash \
    curl \
    wget \
    git \
    jq \
    ca-certificates \
    procps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

ENV PORT=8080
ENV RUNNER_SECRET_KEY=rjn_live_runner_9a8b7c6d5e4f3a2b1

EXPOSE 8080

CMD ["node", "server.js"]
