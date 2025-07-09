class DefaultGameHandler {
  getDockerImage(egg) {
    if (egg.docker_images) {
      const images = Object.values(egg.docker_images)
      if (images.length > 0) {
        return images[0]
      }
    }
    return process.env.DOCKER_IMAGE_DEFAULT || 'ghcr.io/pterodactyl/yolks:java_17'
  }

  getInstallerImage() {
    return process.env.DOCKER_IMAGE_INSTALLER || 'ghcr.io/pterodactyl/installers:debian'
  }

  async ensureImageExists(docker, imageName) {
    try {
      await docker.getImage(imageName).inspect()
      console.log(`✅ Imagem ${imageName} encontrada`)
      return true
    } catch (error) {
      console.log(`📥 Fazendo pull da imagem ${imageName}...`)
      try {
        const stream = await docker.pull(imageName)
        await new Promise((resolve, reject) => {
          docker.modem.followProgress(stream, (err, output) => {
            if (err) reject(err)
            else resolve(output)
          })
        })
        console.log(`✅ Pull da imagem ${imageName} concluído`)
        return true
      } catch (pullError) {
        console.error(`❌ Erro ao fazer pull da imagem ${imageName}:`, pullError.message)
        return false
      }
    }
  }

  async prepareServer(serverDir, config) {
    // Implementação padrão - não faz nada especial
    console.log(`📁 Preparando servidor padrão em ${serverDir}`)
  }

  getEnvironmentVariables(config) {
    return []
  }

  getContainerConfig(serverId, config, dockerImage, startupCommand, envVars, serverDir) {
    return {
      Image: dockerImage,
      name: `pyro-${serverId}`,
      Cmd: ['bash', '-c', startupCommand],
      Env: envVars,
      WorkingDir: '/home/container',
      User: '1000:1000',
      HostConfig: {
        Binds: [`${serverDir}:/home/container:rw`],
        PortBindings: {
          [`${config.port}/tcp`]: [{ HostPort: config.port.toString() }],
          [`${config.port}/udp`]: [{ HostPort: config.port.toString() }]
        },
        Memory: config.plan.ram * 1024 * 1024 * 1024,
        CpuQuota: config.plan.cpu * 100000,
        RestartPolicy: { Name: 'unless-stopped' }
      },
      AttachStdout: true,
      AttachStderr: true,
      AttachStdin: true,
      OpenStdin: true,
      Tty: true,
      Labels: {
        'pyro.server.id': serverId,
        'pyro.server.name': config.name,
        'pyro.server.game': config.game
      }
    }
  }

  isServerOnline(log, egg) {
    if (egg.config && egg.config.startup && egg.config.startup.done) {
      return log.includes(egg.config.startup.done)
    }
    return false
  }
}

module.exports = { DefaultGameHandler }