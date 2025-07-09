#!/bin/bash

echo "🔧 Corrigindo permissões dos servidores..."

# Diretório base dos servidores
SERVERS_DIR="/app/servers"

# Se executando fora do container, usar caminho local
if [ ! -d "$SERVERS_DIR" ]; then
    SERVERS_DIR="./servers"
fi

echo "📁 Diretório dos servidores: $SERVERS_DIR"

# Corrigir permissões para todos os servidores
if [ -d "$SERVERS_DIR" ]; then
    echo "🔄 Alterando proprietário para 1000:1000..."
    chown -R 1000:1000 "$SERVERS_DIR"
    
    echo "🔄 Definindo permissões 755 para diretórios..."
    find "$SERVERS_DIR" -type d -exec chmod 755 {} \;
    
    echo "🔄 Definindo permissões 644 para arquivos..."
    find "$SERVERS_DIR" -type f -exec chmod 644 {} \;
    
    echo "🔄 Definindo permissões 755 para arquivos .jar..."
    find "$SERVERS_DIR" -name "*.jar" -exec chmod 755 {} \;
    
    echo "✅ Permissões corrigidas!"
else
    echo "❌ Diretório $SERVERS_DIR não encontrado"
fi
