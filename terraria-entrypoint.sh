#!/bin/bash
set -e

echo "🎮 Iniciando servidor Terraria..."
echo "👤 UID: ${PUID:-1000}, GID: ${PGID:-1000}"

# Criar usuário se não existir
if ! id -u container >/dev/null 2>&1; then
    groupadd -g ${PGID:-1000} container 2>/dev/null || true
    useradd -u ${PUID:-1000} -g ${PGID:-1000} -d /home/container -s /bin/bash container 2>/dev/null || true
fi

# Criar diretórios necessários para Terraria
mkdir -p /home/container/.local/share/Terraria/Worlds
mkdir -p /home/container/.local/share/Terraria/Players
mkdir -p /home/container/.local/share/Terraria/ModLoader
mkdir -p /home/container/saves

# Corrigir permissões
chown -R ${PUID:-1000}:${PGID:-1000} /home/container
chmod -R 755 /home/container

echo "🚀 Executando comando como usuário container..."
exec gosu container "$@"