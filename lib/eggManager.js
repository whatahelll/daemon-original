const fs = require('fs').promises
const path = require('path')

class EggManager {
  constructor() {
    this.eggsDir = path.join(__dirname, '..', 'eggs')
    this.githubConfig = {
      owner: process.env.EGGS_REPO_OWNER || 'whatahelll',
      repo: process.env.EGGS_REPO_NAME || 'daemon',
      branch: process.env.EGGS_REPO_BRANCH || 'main',
      path: process.env.EGGS_REPO_PATH || 'eggs'
    }
  }

  async ensureEggsDir() {
    try {
      await fs.access(this.eggsDir)
    } catch {
      await fs.mkdir(this.eggsDir, { recursive: true })
      console.log(`📁 Diretório de eggs criado: ${this.eggsDir}`)
    }
  }

  async syncEggs() {
    try {
      console.log('🔄 Sincronizando eggs do GitHub...')
      await this.ensureEggsDir()

      const { owner, repo, branch, path: eggPath } = this.githubConfig
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${eggPath}?ref=${branch}`

      console.log(`📡 Buscando eggs de: ${apiUrl}`)

      const response = await fetch(apiUrl, {
        headers: {
          'User-Agent': 'PyroWings/1.0',
          ...(process.env.GITHUB_TOKEN && {
            'Authorization': `token ${process.env.GITHUB_TOKEN}`
          })
        }
      })

      if (!response.ok) {
        throw new Error(`GitHub API retornou ${response.status}: ${response.statusText}`)
      }

      const files = await response.json()

      if (!Array.isArray(files)) {
        throw new Error('Resposta da API não é um array de arquivos')
      }

      const eggFiles = files.filter(file => 
        file.type === 'file' && 
        file.name.endsWith('.json') &&
        file.download_url
      )

      console.log(`📥 Encontrados ${eggFiles.length} eggs para download`)

      let downloadedCount = 0
      for (const file of eggFiles) {
        try {
          console.log(`📦 Baixando egg: ${file.name}`)
          
          const eggResponse = await fetch(file.download_url)
          if (!eggResponse.ok) {
            console.warn(`⚠️ Falha ao baixar ${file.name}: ${eggResponse.status}`)
            continue
          }

          const eggContent = await eggResponse.text()
          
          // Validar se é um JSON válido
          try {
            JSON.parse(eggContent)
          } catch (parseError) {
            console.warn(`⚠️ Egg ${file.name} não é um JSON válido`)
            continue
          }

          const localPath = path.join(this.eggsDir, file.name)
          await fs.writeFile(localPath, eggContent, 'utf-8')
          
          downloadedCount++
          console.log(`✅ Egg ${file.name} sincronizado`)
        } catch (error) {
          console.error(`❌ Erro ao baixar egg ${file.name}:`, error.message)
        }
      }

      console.log(`🎉 Sincronização concluída: ${downloadedCount}/${eggFiles.length} eggs baixados`)
      return true

    } catch (error) {
      console.error('❌ Erro na sincronização de eggs:', error.message)
      return false
    }
  }

  async getLocalEggs() {
    try {
      await this.ensureEggsDir()
      const files = await fs.readdir(this.eggsDir)
      return files.filter(file => file.endsWith('.json'))
    } catch (error) {
      console.error('❌ Erro ao listar eggs locais:', error)
      return []
    }
  }

  async getEggConfig(eggId) {
    try {
      const eggPath = path.join(this.eggsDir, `${eggId}.json`)
      const eggContent = await fs.readFile(eggPath, 'utf-8')
      return JSON.parse(eggContent)
    } catch (error) {
      throw new Error(`Egg ${eggId} não encontrado ou inválido: ${error.message}`)
    }
  }

  async validateEgg(eggId) {
    try {
      const egg = await this.getEggConfig(eggId)
      
      // Validações básicas
      const requiredFields = ['name', 'startup']
      for (const field of requiredFields) {
        if (!egg[field]) {
          console.warn(`⚠️ Egg ${eggId} está faltando campo obrigatório: ${field}`)
          return false
        }
      }

      // Validar scripts de instalação se existirem
      if (egg.scripts && egg.scripts.installation) {
        if (!egg.scripts.installation.script) {
          console.warn(`⚠️ Egg ${eggId} tem scripts.installation mas falta script`)
          return false
        }
      }

      // Validar variáveis se existirem
      if (egg.variables && Array.isArray(egg.variables)) {
        for (const variable of egg.variables) {
          if (!variable.env_variable || !variable.name) {
            console.warn(`⚠️ Egg ${eggId} tem variável inválida`)
            return false
          }
        }
      }

      return true
    } catch (error) {
      console.warn(`⚠️ Erro ao validar egg ${eggId}:`, error.message)
      return false
    }
  }

  async listAvailableEggs() {
    try {
      const localEggs = await this.getLocalEggs()
      console.log(`\n📋 Eggs disponíveis (${localEggs.length}):`)
      
      for (const eggFile of localEggs) {
        const eggId = eggFile.replace('.json', '')
        try {
          const egg = await this.getEggConfig(eggId)
          const isValid = await this.validateEgg(eggId)
          const status = isValid ? '✅' : '❌'
          console.log(`  ${status} ${eggId}: ${egg.name || 'Sem nome'}`)
        } catch (error) {
          console.log(`  ❌ ${eggId}: Erro ao carregar`)
        }
      }
      
      return localEggs
    } catch (error) {
      console.error('❌ Erro ao listar eggs:', error)
      return []
    }
  }

  async createDefaultEggs() {
    try {
      await this.ensureEggsDir()
      
      // Egg padrão do Minecraft
      const minecraftEgg = {
        "uuid": "default-minecraft",
        "name": "Minecraft Java",
        "description": "Minecraft Java Edition Server",
        "features": ["java_version", "pid_limit"],
        "docker_images": {
          "java": "ghcr.io/pterodactyl/yolks:java_21"
        },
        "config": {
          "files": {
            "server.properties": {
              "parser": "properties",
              "find": {
                "server-port": "{{server.build.default.port}}",
                "max-players": "{{server.build.env.MAX_PLAYERS}}"
              }
            }
          },
          "startup": {
            "done": "Time elapsed:"
          },
          "stop": "stop",
          "logs": {}
        },
        "scripts": {
          "installation": {
            "script": "#!/bin/bash\ncd /mnt/server\n\nif [ ! -f server.jar ]; then\n    echo \"Downloading Minecraft server...\"\n    wget -O server.jar https://launcher.mojang.com/v1/objects/450698d1863ab5180c25d7c804ef0fe6369dd1ba/server.jar\nfi\n\necho \"eula=true\" > eula.txt\necho \"Installation completed!\"",
            "container": "ghcr.io/pterodactyl/installers:debian",
            "entrypoint": "bash"
          }
        },
        "variables": [
          {
            "name": "Server Version",
            "description": "The version of Minecraft to download",
            "env_variable": "MINECRAFT_VERSION",
            "default_value": "latest",
            "user_viewable": true,
            "user_editable": true,
            "rules": "required|string|max:20"
          },
          {
            "name": "Max Players",
            "description": "Maximum number of players",
            "env_variable": "MAX_PLAYERS",
            "default_value": "20",
            "user_viewable": true,
            "user_editable": true,
            "rules": "required|integer|min:1|max:100"
          }
        ],
        "startup": "java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar server.jar nogui"
      }

      // Egg padrão do Terraria
      const terrariaEgg = {
        "uuid": "default-terraria",
        "name": "Terraria",
        "description": "Terraria Dedicated Server",
        "features": [],
        "docker_images": {
          "mono": "mono:latest"
        },
        "config": {
          "startup": {
            "done": "Server started"
          },
          "stop": "exit",
          "logs": {}
        },
        "scripts": {
          "installation": {
            "script": "#!/bin/bash\ncd /mnt/server\n\necho \"Downloading Terraria server...\"\nwget -O terraria-server.zip \"https://terraria.org/api/download/pc-dedicated-server/terraria-server-1449.zip\"\nunzip terraria-server.zip\ncp -r */Linux/* .\nchmod +x TerrariaServer.bin.x86_64\nrm -rf terraria-server.zip */\necho \"Terraria server installed successfully\"",
            "container": "ghcr.io/pterodactyl/installers:debian",
            "entrypoint": "bash"
          }
        },
        "variables": [
          {
            "name": "World Name",
            "description": "The name of the world",
            "env_variable": "WORLD_NAME",
            "default_value": "PyroWorld",
            "user_viewable": true,
            "user_editable": true,
            "rules": "required|string|max:20"
          },
          {
            "name": "Max Players",
            "description": "Maximum number of players",
            "env_variable": "MAX_PLAYERS",
            "default_value": "8",
            "user_viewable": true,
            "user_editable": true,
            "rules": "required|integer|min:1|max:255"
          },
          {
            "name": "Server Password",
            "description": "Password for the server (optional)",
            "env_variable": "SERVER_PASSWORD",
            "default_value": "",
            "user_viewable": true,
            "user_editable": true,
            "rules": "nullable|string"
          }
        ],
        "startup": "./TerrariaServer.bin.x86_64 -config serverconfig.txt -world /home/container/saves/world.wld"
      }

      // Salvar eggs padrão
      await fs.writeFile(
        path.join(this.eggsDir, 'minecraft.json'), 
        JSON.stringify(minecraftEgg, null, 2)
      )
      
      await fs.writeFile(
        path.join(this.eggsDir, 'terraria.json'), 
        JSON.stringify(terrariaEgg, null, 2)
      )

      console.log('✅ Eggs padrão criados: minecraft.json, terraria.json')
      
    } catch (error) {
      console.error('❌ Erro ao criar eggs padrão:', error)
    }
  }

  async getEggsByGame(game) {
    try {
      const localEggs = await this.getLocalEggs()
      const gameEggs = []

      for (const eggFile of localEggs) {
        const eggId = eggFile.replace('.json', '')
        try {
          const egg = await this.getEggConfig(eggId)
          
          // Verificar se o egg é para o jogo solicitado
          if (eggId.toLowerCase().includes(game.toLowerCase()) || 
              (egg.name && egg.name.toLowerCase().includes(game.toLowerCase()))) {
            gameEggs.push({
              id: eggId,
              name: egg.name,
              description: egg.description
            })
          }
        } catch (error) {
          console.warn(`⚠️ Erro ao processar egg ${eggId}:`, error.message)
        }
      }

      return gameEggs
    } catch (error) {
      console.error(`❌ Erro ao buscar eggs para ${game}:`, error)
      return []
    }
  }
}

module.exports = { EggManager }