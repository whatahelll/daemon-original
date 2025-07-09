FROM node:18-alpine

# Instalar Docker CLI e dependências
RUN apk add --no-cache \
    docker-cli \
    bash \
    curl \
    git \
    ca-certificates

WORKDIR /app

# Copiar package.json e package-lock.json
COPY package*.json ./

# Instalar dependências (usar npm install em vez de npm ci por simplicidade)
RUN npm install --omit=dev

# Copiar código fonte
COPY . .

# Criar diretórios necessários
RUN mkdir -p /app/servers /app/logs /app/configs /app/eggs && \
    chown -R node:node /app

# Expor porta
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

# Mudar para usuário node
USER node

# Comando de inicialização
CMD ["npm", "start"]
