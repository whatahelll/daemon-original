const fs = require('fs').promises
const path = require('path')
const { DefaultGameHandler } = require('./default')

class TerrariaGameHandler extends DefaultGameHandler {
  getDockerImage(egg) {
    const customImage = process.env.DOCKER_IMAGE_PYRO_TERRARIA
    if (customImage) {
      console.log(`🐳 Usando imagem customizada para Terraria: ${customImage}`)
      return customImage
    }
    
    // Fallback para imagem mono
    return process.env.DOCKER_IMAGE_DOTNET || 'mono:latest'
  }

  async prepareServer(serverDir, config) {
    console.log(`🎮 Preparando servidor Terraria em ${serverDir}`)
    
    // Criar diretórios específicos do Terraria
    const terrariaDirs = [
      '.local/share/Terraria/Worlds',
      '.local/share/Terraria/Players',
      '.local/share/Terraria/ModLoader',
      'saves'
    ]
    
    for (const dir of terrariaDirs) {
      await fs.mkdir(path.join(serverDir, dir), { recursive: true })
    }
    
    // Criar arquivo de configuração do servidor se não existir
    const configPath = path.join(serverDir, 'serverconfig.txt')
    try {
      await fs.access(configPath)
    } catch {
      const serverConfig = `world=/home/container/saves/world.wld
autocreate=${config.variables?.AUTOCREATE || '2'}
worldname=${config.variables?.WORLD_NAME || 'PyroWorld'}
difficulty=${config.variables?.DIFFICULTY || '1'}
maxplayers=${config.variables?.MAX_PLAYERS || '8'}
port=${config.port}
password=${config.variables?.SERVER_PASSWORD || ''}
motd=${config.variables?.SERVER_MOTD || 'Welcome to Pyro Terraria Server!'}
worldpath=/home/container/saves/
banlist=banlist.txt
secure=1
language=en-US
npcstream=60
priority=1
`
      await fs.writeFile(configPath, serverConfig)
      console.log('📄 serverconfig.txt criado')
    }
    
    // Criar arquivo de banlist vazio se não existir
    const banlistPath = path.join(serverDir, 'banlist.txt')
    try {
      await fs.access(banlistPath)
    } catch {
      await fs.writeFile(banlistPath, '')
      console.log('📄 banlist.txt criado')
    }
  }

  getEnvironmentVariables(config) {
    return [
      `WORLD_NAME=${config.variables?.WORLD_NAME || 'PyroWorld'}`,
      `MAX_PLAYERS=${config.variables?.MAX_PLAYERS || '8'}`,
      `SERVER_PASSWORD=${config.variables?.SERVER_PASSWORD || ''}`,
      `AUTOCREATE=${config.variables?.AUTOCREATE || '2'}`,
      `DIFFICULTY=${config.variables?.DIFFICULTY || '1'}`,
      `WORLD_SIZE=${config.variables?.WORLD_SIZE || '2'}`
    ]
  }

  getContainerConfig(serverId, config, dockerImage, startupCommand, envVars, serverDir) {
    const baseConfig = super.getContainerConfig(serverId, config, dockerImage, startupCommand, envVars, serverDir)
    
    return {
      ...baseConfig,
      User: 'root', // Terraria precisa rodar como root inicialmente para corrigir permissões
      HostConfig: {
        ...baseConfig.HostConfig,
        CapAdd: ['CHOWN', 'DAC_OVERRIDE'],
        SecurityOpt: ['no-new-privileges:false']
      }
    }
  }

  isServerOnline(log, egg) {
    // Padrões comuns de log que indicam que o servidor Terraria está online
    const onlinePatterns = [
      'Server started',
      'Listening on port',
      'Type \'help\' for a list of commands',
      'Server is now online',
      'Ready for players'
    ]
    
    for (const pattern of onlinePatterns) {
      if (log.includes(pattern)) {
        return true
      }
    }
    
    return super.isServerOnline(log, egg)
  }
}

module.exports = { TerrariaGameHandler }