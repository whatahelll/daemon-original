const express = require('express')
const http = require('http')
const socketIo = require('socket.io')
const Docker = require('dockerode')
const fs = require('fs').promises
const path = require('path')
const cors = require('cors')
const { EggManager } = require('./lib/eggManager')
const { MinecraftGameHandler } = require('./lib/gameHandlers/minecraft')
const { TerrariaGameHandler } = require('./lib/gameHandlers/terraria')
const { DefaultGameHandler } = require('./lib/gameHandlers/default')

const app = express()
const server = http.createServer(app)
const io = socketIo(server, {
 cors: {
   origin: "*",
   methods: ["GET", "POST"]
 }
})

const docker = new Docker()
const eggManager = new EggManager()
const PORT = process.env.PORT || 8080
const SERVERS_DIR = path.join(__dirname, 'servers')
const CONFIGS_DIR = path.join(__dirname, 'configs')

app.use(cors())
app.use(express.json())

class GameHandlerManager {
 constructor() {
   this.handlers = new Map()
   this.setupHandlers()
 }

 setupHandlers() {
   this.handlers.set('minecraft', new MinecraftGameHandler())
   this.handlers.set('terraria', new TerrariaGameHandler())
   this.handlers.set('default', new DefaultGameHandler())
 }

 getHandler(game) {
   return this.handlers.get(game) || this.handlers.get('default')
 }
}

const gameHandlerManager = new GameHandlerManager()

async function ensureDirectories() {
 await fs.mkdir(SERVERS_DIR, { recursive: true })
 await fs.mkdir(CONFIGS_DIR, { recursive: true })
}

async function loadEgg(eggId) {
 try {
   console.log(`🥚 Carregando egg: ${eggId}`)
   return await eggManager.getEggConfig(eggId)
 } catch (error) {
   console.error(`❌ Erro ao carregar egg ${eggId}:`, error.message)
   throw new Error(`Egg ${eggId} não encontrado ou inválido`)
 }
}

async function notifyPanelStatus(serverId, status) {
 try {
   const panelUrl = process.env.PANEL_URL || 'http://192.168.0.117:3000'
   
   const controller = new AbortController()
   const timeoutId = setTimeout(() => controller.abort(), 10000)
   
   const response = await fetch(`${panelUrl}/api/servers/${serverId}/status`, {
     method: 'PUT',
     headers: { 
       'Content-Type': 'application/json',
       'User-Agent': 'PyroWings/1.0'
     },
     body: JSON.stringify({ status }),
     signal: controller.signal
   })
   
   clearTimeout(timeoutId)
   
   if (response.ok) {
     console.log(`📊 Status ${status} notificado ao painel para ${serverId}`)
   }
 } catch (error) {
   console.error(`❌ Erro ao notificar painel:`, error.message)
 }
}

async function getServerContainer(serverId) {
 try {
   const containers = await docker.listContainers({ all: true })
   const serverContainer = containers.find(container => 
     container.Names.some(name => name.includes(`pyro-${serverId}`)) ||
     (container.Labels && container.Labels['pyro.server.id'] === serverId)
   )
   
   if (serverContainer) {
     return docker.getContainer(serverContainer.Id)
   }
   
   return null
 } catch (error) {
   console.error('Erro ao buscar container:', error)
   return null
 }
}

app.get('/health', (req, res) => {
 res.json({ 
   status: 'ok', 
   timestamp: new Date().toISOString(),
   version: '1.0.0'
 })
})

app.post('/api/servers/:serverId/config', async (req, res) => {
 try {
   const { serverId } = req.params
   const config = req.body
   
   console.log(`🔧 Criando configuração para servidor: ${serverId}`)
   
   const configPath = path.join(CONFIGS_DIR, `${serverId}.json`)
   await fs.writeFile(configPath, JSON.stringify(config, null, 2))
   
   const serverDir = path.join(SERVERS_DIR, serverId)
   await fs.mkdir(serverDir, { recursive: true })
   
   res.json({ success: true, message: 'Configuração criada' })
 } catch (error) {
   console.error('Erro ao criar configuração:', error)
   res.status(500).json({ error: error.message })
 }
})

app.post('/api/servers/:serverId/install', async (req, res) => {
 try {
   const { serverId } = req.params
   
   console.log(`📦 Instalando servidor: ${serverId}`)
   
   const configPath = path.join(CONFIGS_DIR, `${serverId}.json`)
   const configData = await fs.readFile(configPath, 'utf-8')
   const config = JSON.parse(configData)
   
   const egg = await loadEgg(config.eggId)
   const serverDir = path.join(SERVERS_DIR, serverId)
   
   io.emit('server-status', { serverId, status: 'installing' })
   await notifyPanelStatus(serverId, 'installing')
   
   if (egg.scripts && egg.scripts.installation) {
     await runInstallationScript(serverId, egg, config, serverDir)
   } else {
     console.log(`⚠️ Nenhum script de instalação definido para ${config.eggId}`)
     io.emit('server-status', { serverId, status: 'offline' })
     await notifyPanelStatus(serverId, 'offline')
   }
   
   res.json({ success: true, message: 'Instalação iniciada' })
 } catch (error) {
   console.error('Erro na instalação:', error)
   io.emit('server-status', { serverId: req.params.serverId, status: 'install_failed' })
   await notifyPanelStatus(req.params.serverId, 'install_failed')
   res.status(500).json({ error: error.message })
 }
})

async function runInstallationScript(serverId, egg, config, serverDir) {
 console.log(`🔨 Executando script de instalação para ${serverId}`)
 
 const gameHandler = gameHandlerManager.getHandler(config.game)
 const installScript = egg.scripts.installation.script
 const installContainer = egg.scripts.installation.container || gameHandler.getInstallerImage()
 
 const envVars = []

 if (egg.variables) {
   egg.variables.forEach(variable => {
     const value = config.variables?.[variable.env_variable] || variable.default_value
     envVars.push(`${variable.env_variable}=${value}`)
   })
 }
 
 envVars.push(`SERVER_MEMORY=${config.plan.ram * 1024}`)
 envVars.push(`SERVER_PORT=${config.port}`)
 envVars.push(`PUID=1000`)
 envVars.push(`PGID=1000`)
 
 try {
   const imageExists = await gameHandler.ensureImageExists(docker, installContainer)
   if (!imageExists) {
     throw new Error(`Falha ao obter imagem de instalação: ${installContainer}`)
   }

   const container = await docker.createContainer({
     Image: installContainer,
     Cmd: ['bash', '-c', installScript],
     Env: envVars,
     WorkingDir: '/mnt/server',
     HostConfig: {
       Binds: [`${serverDir}:/mnt/server`],
       Memory: config.plan.ram * 1024 * 1024 * 1024,
       CpuQuota: config.plan.cpu * 100000,
       AutoRemove: true
     },
     AttachStdout: true,
     AttachStderr: true
   })
   
   const stream = await container.attach({
     stream: true,
     stdout: true,
     stderr: true
   })
   
   stream.on('data', (chunk) => {
     const log = chunk.toString()
     console.log(`[INSTALL ${serverId}] ${log}`)
     io.emit('server-log', {
       serverId,
       timestamp: new Date().toISOString(),
       level: 'info',
       message: log.trim()
     })
   })
   
   await container.start()
   const result = await container.wait()
   
   if (result.StatusCode === 0) {
     console.log(`✅ Instalação concluída para ${serverId}`)
     await notifyPanelStatus(serverId, 'offline')
     io.emit('server-status', { serverId, status: 'offline' })
   } else {
     console.error(`❌ Instalação falhou para ${serverId} com código ${result.StatusCode}`)
     await notifyPanelStatus(serverId, 'install_failed')
     io.emit('server-status', { serverId, status: 'install_failed' })
     throw new Error(`Installation failed with exit code ${result.StatusCode}`)
   }
   
 } catch (error) {
   console.error(`❌ Erro na instalação do ${serverId}:`, error)
   await notifyPanelStatus(serverId, 'install_failed')
   io.emit('server-status', { serverId, status: 'install_failed' })
   throw error
 }
}

app.post('/api/servers/:serverId/start', async (req, res) => {
 try {
   const { serverId } = req.params
   
   console.log(`🚀 Iniciando servidor: ${serverId}`)
   
   const configPath = path.join(CONFIGS_DIR, `${serverId}.json`)
   const configData = await fs.readFile(configPath, 'utf-8')
   const config = JSON.parse(configData)
   
   const egg = await loadEgg(config.eggId)
   const gameHandler = gameHandlerManager.getHandler(config.game)
   
   const existingContainer = await getServerContainer(serverId)
   if (existingContainer) {
     const containerInfo = await existingContainer.inspect()
     if (containerInfo.State.Running) {
       return res.status(400).json({ error: 'Servidor já está rodando' })
     } else {
       await existingContainer.remove({ force: true })
     }
   }
   
   const serverDir = path.join(SERVERS_DIR, serverId)
   const dockerImage = gameHandler.getDockerImage(egg)
   
   const imageExists = await gameHandler.ensureImageExists(docker, dockerImage)
   if (!imageExists) {
     throw new Error(`Falha ao obter imagem: ${dockerImage}`)
   }
   
   // Preparar servidor usando o handler específico do jogo
   await gameHandler.prepareServer(serverDir, config)
   
   const envVars = []
   if (egg.variables) {
     egg.variables.forEach(variable => {
       const value = config.variables?.[variable.env_variable] || variable.default_value
       envVars.push(`${variable.env_variable}=${value}`)
     })
   }
   
   envVars.push(`SERVER_MEMORY=${config.plan.ram * 1024}`)
   envVars.push(`SERVER_PORT=${config.port}`)
   envVars.push(`PUID=1000`)
   envVars.push(`PGID=1000`)
   
   // Adicionar variáveis específicas do jogo
   const gameEnvVars = gameHandler.getEnvironmentVariables(config)
   envVars.push(...gameEnvVars)
   
   let startupCommand = egg.startup || 'echo "No startup command defined"'
   
   if (egg.variables) {
     egg.variables.forEach(variable => {
       const value = config.variables?.[variable.env_variable] || variable.default_value
       const placeholder = `{{${variable.env_variable}}}`
       startupCommand = startupCommand.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value)
     })
   }
   
   startupCommand = startupCommand.replace(/{{SERVER_MEMORY}}/g, config.plan.ram * 1024)
   startupCommand = startupCommand.replace(/{{server\.build\.default\.port}}/g, config.port)
   
   console.log(`💻 Comando de startup: ${startupCommand}`)
   
   const containerConfig = gameHandler.getContainerConfig(serverId, config, dockerImage, startupCommand, envVars, serverDir)
   
   const container = await docker.createContainer(containerConfig)
   
   const stream = await container.attach({
     stream: true,
     stdout: true,
     stderr: true,
     stdin: true
   })
   
   stream.on('data', (chunk) => {
     const log = chunk.toString()
     console.log(`[${serverId}] ${log}`)
     
     io.emit('server-log', {
       serverId,
       timestamp: new Date().toISOString(),
       level: 'info',
       message: log.trim()
     })
     
     // Verificar se o servidor está online usando o handler específico
     if (gameHandler.isServerOnline(log, egg)) {
       console.log(`✅ Servidor ${serverId} está online`)
       io.emit('server-status', { serverId, status: 'online' })
       notifyPanelStatus(serverId, 'online')
     }
   })
   
   await container.start()
   
   console.log(`🎮 Servidor ${serverId} iniciado`)
   io.emit('server-status', { serverId, status: 'starting' })
   await notifyPanelStatus(serverId, 'starting')
   
   res.json({ success: true, message: 'Servidor iniciado' })
 } catch (error) {
   console.error('Erro ao iniciar servidor:', error)
   io.emit('server-status', { serverId: req.params.serverId, status: 'error' })
   await notifyPanelStatus(req.params.serverId, 'error')
   res.status(500).json({ error: error.message })
 }
})

app.post('/api/servers/:serverId/stop', async (req, res) => {
 try {
   const { serverId } = req.params
   
   const container = await getServerContainer(serverId)
   if (!container) {
     return res.status(404).json({ error: 'Container não encontrado' })
   }
   
   const containerInfo = await container.inspect()
   if (!containerInfo.State.Running) {
     return res.status(400).json({ error: 'Servidor não está rodando' })
   }
   
   await container.stop({ t: 10 })
   await container.remove()
   
   console.log(`✅ Servidor ${serverId} parado`)
   io.emit('server-status', { serverId, status: 'offline' })
   await notifyPanelStatus(serverId, 'offline')
   res.json({ success: true, message: 'Servidor parado' })
 } catch (error) {
   console.error('Erro ao parar servidor:', error)
   res.status(500).json({ error: error.message })
 }
})

app.post('/api/servers/:serverId/restart', async (req, res) => {
 try {
   const { serverId } = req.params
   
   const container = await getServerContainer(serverId)
   if (container) {
     const containerInfo = await container.inspect()
     if (containerInfo.State.Running) {
       await container.stop({ t: 10 })
       await container.remove()
     }
   }
   
   await new Promise(resolve => setTimeout(resolve, 2000))
   
   const startResponse = await fetch(`http://localhost:${PORT}/api/servers/${serverId}/start`, {
     method: 'POST'
   })
   
   if (startResponse.ok) {
     res.json({ success: true, message: 'Servidor reiniciado' })
   } else {
     throw new Error('Falha ao reiniciar servidor')
   }
 } catch (error) {
   console.error('Erro ao reiniciar servidor:', error)
   res.status(500).json({ error: error.message })
 }
})

app.post('/api/servers/:serverId/kill', async (req, res) => {
 try {
   const { serverId } = req.params
   
   const container = await getServerContainer(serverId)
   if (!container) {
     return res.status(404).json({ error: 'Container não encontrado' })
   }
   
   await container.kill()
   await container.remove()
   
   console.log(`☠️ Servidor ${serverId} forçado a parar`)
   io.emit('server-status', { serverId, status: 'offline' })
   await notifyPanelStatus(serverId, 'offline')
   
   res.json({ success: true, message: 'Servidor forçado a parar' })
 } catch (error) {
   console.error('Erro ao forçar parada:', error)
   res.status(500).json({ error: error.message })
 }
})

app.get('/api/servers/:serverId/stats', async (req, res) => {
 try {
   const { serverId } = req.params
   
   const container = await getServerContainer(serverId)
   if (!container) {
     return res.status(404).json({ error: 'Container não encontrado' })
   }
   
   const containerInfo = await container.inspect()
   if (!containerInfo.State.Running) {
     return res.json({
       cpu: 0,
       memory: { used: 0, total: 0, percent: 0 },
       network: { rx: 0, tx: 0 }
     })
   }
   
   const stats = await container.stats({ stream: false })
   
   const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage
   const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage
   const cpuPercent = (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100
   
   const memoryUsage = stats.memory_stats.usage || 0
   const memoryLimit = stats.memory_stats.limit || 0
   const memoryPercent = memoryLimit ? (memoryUsage / memoryLimit) * 100 : 0
   
   const networkRx = stats.networks?.eth0?.rx_bytes || 0
   const networkTx = stats.networks?.eth0?.tx_bytes || 0
   
   res.json({
     cpu: Math.round(cpuPercent * 100) / 100,
     memory: {
       used: Math.round(memoryUsage / 1024 / 1024),
       total: Math.round(memoryLimit / 1024 / 1024),
       percent: Math.round(memoryPercent * 100) / 100
     },
     network: {
       rx: networkRx,
       tx: networkTx
     }
   })
 } catch (error) {
   console.error('Erro ao obter estatísticas:', error)
   res.status(500).json({ error: error.message })
 }
})

app.get('/api/servers/:serverId/logs', async (req, res) => {
 try {
   const { serverId } = req.params
   const lines = parseInt(req.query.lines) || 100
   
   const container = await getServerContainer(serverId)
   if (!container) {
     return res.status(404).json({ error: 'Container não encontrado' })
   }
   
   const logs = await container.logs({
     stdout: true,
     stderr: true,
     tail: lines,
     timestamps: true
   })
   
   const logLines = logs.toString().split('\n')
     .filter(line => line.trim())
     .map(line => {
       const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)/)
       const timestamp = timestampMatch ? timestampMatch[1] : new Date().toISOString()
       const message = line.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s*/, '')
       
       return {
         timestamp,
         level: message.includes('ERROR') ? 'error' : 
                message.includes('WARN') ? 'warning' : 'info',
         message: message.trim()
       }
     })
   
   res.json(logLines)
 } catch (error) {
   console.error('Erro ao obter logs:', error)
   res.status(500).json({ error: error.message })
 }
})

app.post('/api/servers/:serverId/command', async (req, res) => {
 try {
   const { serverId } = req.params
   const { command } = req.body
   
   if (!command) {
     return res.status(400).json({ error: 'Comando é obrigatório' })
   }
   
   const container = await getServerContainer(serverId)
   if (!container) {
     return res.status(404).json({ error: 'Container não encontrado' })
   }
   
   const containerInfo = await container.inspect()
   if (!containerInfo.State.Running) {
     return res.status(400).json({ error: 'Servidor não está rodando' })
   }
   
   const exec = await container.exec({
     Cmd: ['bash', '-c', `echo "${command}" > /proc/1/fd/0`],
     AttachStdout: true,
     AttachStderr: true
   })
   
   await exec.start()
   
   io.emit('command-output', {
     serverId,
     command,
     output: `Command sent: ${command}`,
     timestamp: new Date().toISOString()
   })
   
   res.json({ success: true, message: 'Comando enviado' })
 } catch (error) {
   console.error('Erro ao enviar comando:', error)
   res.status(500).json({ error: error.message })
 }
})

io.on('connection', (socket) => {
 console.log('🔌 Cliente conectado ao WebSocket')
 
 socket.on('join-server', (serverId) => {
   socket.join(serverId)
   console.log(`📝 Cliente entrou no servidor: ${serverId}`)
 })
 
 socket.on('leave-server', (serverId) => {
   socket.leave(serverId)
   console.log(`📤 Cliente saiu do servidor: ${serverId}`)
 })
 
 socket.on('send-command', async (data) => {
   const { serverId, command } = data
   
   try {
     const container = await getServerContainer(serverId)
     if (container) {
       const exec = await container.exec({
         Cmd: ['bash', '-c', `echo "${command}" > /proc/1/fd/0`],
         AttachStdout: true,
         AttachStderr: true
       })
       
       await exec.start()
       
       io.to(serverId).emit('command-output', {
         command,
         output: `Command sent: ${command}`,
         timestamp: new Date().toISOString()
       })
     }
   } catch (error) {
     console.error('Erro ao enviar comando via WebSocket:', error)
     io.to(serverId).emit('command-output', {
       command,
       output: `Error: ${error.message}`,
       error: true,
       timestamp: new Date().toISOString()
     })
   }
 })
 
 socket.on('disconnect', () => {
   console.log('🔌 Cliente desconectado')
 })
})

async function startWings() {
 try {
   await ensureDirectories()
   
   console.log('🔥 Pyro Wings Daemon iniciando...')
   console.log(`📡 Porta: ${PORT}`)
   
   try {
     await docker.ping()
     console.log('🐳 Docker conectado com sucesso')
   } catch (dockerError) {
     console.error('❌ Erro ao conectar com Docker:', dockerError)
     process.exit(1)
   }
   
   console.log('\n🥚 Sincronizando eggs...')
   const syncSuccess = await eggManager.syncEggs()
   
   if (syncSuccess) {
     console.log('✅ Eggs sincronizados com sucesso')
   } else {
     console.log('⚠️ Falha na sincronização de eggs, continuando...')
   }
   
   server.listen(PORT, () => {
     console.log(`\n🚀 Wings Daemon rodando na porta ${PORT}`)
     console.log(`🌐 Health check: http://localhost:${PORT}/health`)
     console.log(`🎮 Pronto para criar servidores!`)
   })
   
 } catch (error) {
   console.error('❌ Erro ao iniciar Wings:', error)
   process.exit(1)
 }
}

process.on('SIGTERM', async () => {
 console.log('🛑 Recebido SIGTERM, parando Wings...')
 server.close(() => {
   console.log('✅ Wings parado')
   process.exit(0)
 })
})

process.on('SIGINT', async () => {
 console.log('🛑 Recebido SIGINT, parando Wings...')
 server.close(() => {
   console.log('✅ Wings parado')
   process.exit(0)
 })
})

startWings()