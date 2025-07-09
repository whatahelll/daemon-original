const fs = require('fs').promises
const path = require('path')
const { DefaultGameHandler } = require('./default')

class MinecraftGameHandler extends DefaultGameHandler {
  getDockerImage(egg) {
    const customImage = process.env.DOCKER_IMAGE_PYRO_MINECRAFT
    if (customImage) {
      console.log(`🐳 Usando imagem customizada para Minecraft: ${customImage}`)
      return customImage
    }
    return super.getDockerImage(egg)
  }

  async prepareServer(serverDir, config) {
    console.log(`🎮 Preparando servidor Minecraft em ${serverDir}`)
    
    const minecraftDirs = [
      'versions',
      'world', 
      'logs',
      'plugins',
      'mods',
      'config',
      'libraries'
    ]
    
    for (const dir of minecraftDirs) {
      await fs.mkdir(path.join(serverDir, dir), { recursive: true })
    }
    
    // Criar EULA se não existir
    const eulaPath = path.join(serverDir, 'eula.txt')
    try {
      await fs.access(eulaPath)
    } catch {
      await fs.writeFile(eulaPath, 'eula=true\n')
      console.log('📄 EULA criado')
    }
    
    // Criar server.properties básico se não existir
    const propsPath = path.join(serverDir, 'server.properties')
    try {
      await fs.access(propsPath)
    } catch {
      const serverProps = `server-port=${config.port}
max-players=${config.variables?.MAX_PLAYERS || 20}
motd=${config.variables?.SERVER_MOTD || 'A Pyro Minecraft Server'}
gamemode=${config.variables?.GAMEMODE || 'survival'}
difficulty=${config.variables?.DIFFICULTY || 'normal'}
level-name=${config.variables?.LEVEL_NAME || 'world'}
level-seed=${config.variables?.LEVEL_SEED || ''}
pvp=${config.variables?.PVP || 'true'}
online-mode=${config.variables?.ONLINE_MODE || 'true'}
white-list=${config.variables?.WHITE_LIST || 'false'}
enforce-whitelist=${config.variables?.ENFORCE_WHITELIST || 'false'}
spawn-protection=${config.variables?.SPAWN_PROTECTION || '16'}
max-world-size=${config.variables?.MAX_WORLD_SIZE || '29999984'}
enable-command-block=${config.variables?.ENABLE_COMMAND_BLOCK || 'false'}
`
      await fs.writeFile(propsPath, serverProps)
      console.log('📄 server.properties criado')
    }
  }

  getEnvironmentVariables(config) {
    return [
      `MINECRAFT_VERSION=${config.variables?.MINECRAFT_VERSION || 'latest'}`,
      `SERVER_TYPE=${config.variables?.SERVER_TYPE || 'VANILLA'}`,
      `EULA=TRUE`,
      `ENABLE_RCON=${config.variables?.ENABLE_RCON || 'true'}`,
      `RCON_PORT=${config.variables?.RCON_PORT || '25575'}`,
      `RCON_PASSWORD=${config.variables?.RCON_PASSWORD || 'minecraft'}`
    ]
  }

  getContainerConfig(serverId, config, dockerImage, startupCommand, envVars, serverDir) {
    const baseConfig = super.getContainerConfig(serverId, config, dockerImage, startupCommand, envVars, serverDir)
    
    return {
      ...baseConfig,
      User: 'root', // Minecraft precisa rodar como root inicialmente para corrigir permissões
      HostConfig: {
        ...baseConfig.HostConfig,
        CapAdd: ['CHOWN', 'DAC_OVERRIDE'],
        SecurityOpt: ['no-new-privileges:false']
      }
    }
  }

  isServerOnline(log, egg) {
    // Padrões comuns de log que indicam que o servidor Minecraft está online
    const onlinePatterns = [
      'Done (',
      'Time elapsed:',
      'For help, type "help"',
      'Starting minecraft server version',
      'Server startup complete'
    ]
    
    for (const pattern of onlinePatterns) {
      if (log.includes(pattern)) {
        return true
      }
    }
    
    return super.isServerOnline(log, egg)
  }
}

module.exports = { MinecraftGameHandler }