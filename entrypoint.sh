#!/bin/bash

# Script de entrada para containers Minecraft
# Resolve problemas de permissão do Minecraft 1.21+

set -e

# Definir variáveis
CONTAINER_UID=${PUID:-1000}
CONTAINER_GID=${PGID:-1000}
WORKDIR="/home/container"

echo "🔧 Iniciando container Minecraft..."
echo "👤 UID: $CONTAINER_UID, GID: $CONTAINER_GID"
echo "📁 Workdir: $WORKDIR"

# Função para executar como root se necessário
run_as_root() {
    if [ "$(id -u)" = "0" ]; then
        "$@"
    else
        echo "⚠️ Não é possível executar como root: $*"
    fi
}

# Corrigir permissões se executando como root
if [ "$(id -u)" = "0" ]; then
    echo "🔧 Executando como root, corrigindo permissões..."
    
    # Garantir que o usuário container existe
    if ! id -u container >/dev/null 2>&1; then
        groupadd -g $CONTAINER_GID container 2>/dev/null || true
        useradd -u $CONTAINER_UID -g $CONTAINER_GID -d $WORKDIR -s /bin/bash container 2>/dev/null || true
    fi
    
    # Criar diretórios necessários
    mkdir -p $WORKDIR/versions $WORKDIR/logs $WORKDIR/world
    
    # Corrigir permissões de todos os arquivos e diretórios
    chown -R $CONTAINER_UID:$CONTAINER_GID $WORKDIR
    chmod -R 755 $WORKDIR
    
    # Executar o comando como usuário container
    echo "🚀 Executando comando como usuário container..."
    exec gosu container "$@"
else
    echo "🚀 Executando como usuário container..."
    
    # Criar diretórios necessários como usuário normal
    mkdir -p $WORKDIR/versions $WORKDIR/logs $WORKDIR/world 2>/dev/null || true
    
    # Executar comando diretamente
    exec "$@"
fi
