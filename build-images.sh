#!/bin/bash

echo "🐳 Construindo imagens customizadas..."

# Minecraft
echo "📦 Construindo imagem do Minecraft..."
docker build -f minecraft.Dockerfile -t pyro-minecraft:latest .

# Terraria  
echo "📦 Construindo imagem do Terraria..."
docker build -f terraria.Dockerfile -t pyro-terraria:latest .

echo "✅ Todas as imagens foram construídas!"