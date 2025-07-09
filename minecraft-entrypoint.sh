#!/bin/bash
set -e

echo "🎮 Iniciando servidor Minecraft..."
echo "👤 UID: ${PUID:-1000}, GID: ${PGID:-1000}"

# Criar usuário se não existir
if ! id -u container >/dev/null 2>&1; then
    groupadd -g ${PGID:-1000} container 2>/dev/null || true
    useradd -u ${PUID:-1000} -g ${PGID:-1000} -d /home/container -s /bin/bash container 2>/dev/null || true
fi

# Criar diretórios necessários para Minecraft
mkdir -p /home/container/versions
mkdir -p /home/container/world
mkdir -p /home/container/logs
mkdir -p /home/container/plugins
mkdir -p /home/container/mods
mkdir -p /home/container/config
mkdir -p /home/container/libraries

# Corrigir permissões
chown -R ${PUID:-1000}:${PGID:-1000} /home/container
chmod -R 755 /home/container

# Criar EULA se não existir
if [ ! -f "/home/container/eula.txt" ]; then
    echo "eula=true" > /home/container/eula.txt
    chown ${PUID:-1000}:${PGID:-1000} /home/container/eula.txt
fi

echo "🚀 Executando comando como usuário container..."
exec gosu container "$@"