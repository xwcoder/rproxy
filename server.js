const PATH = require('path')
const mime = require('./lib/mime')
const fs = require('fs')
const http = require('http')
const https = require('https')
const httpProxy = require('http-proxy')
const Koa = require('koa')
const ecstatic = require('ecstatic')

const proxy = httpProxy.createProxyServer()
const app = new Koa()

const {configFilePath, config} = (x => {

  var args = process.argv.slice(2)

  var configFilePath = args[0] || './config'

  if (/^[^\.\/]/.test(configFilePath)) {
    configFilePath = './' + configFilePath
  }

  var config = require(configFilePath)

  return {config, configFilePath}

})()

const host = config.host || '0.0.0.0'
const port = config.port || 80

const openFile = (path, flag) =>
  new Promise((resolve, reject) => fs.open(path, flag, (err, fd) => err ? reject(err) : resolve(fd)))

const readFile = (file, options) =>
  new Promise((resolve, reject) => fs.readFile(file, options, (err, data) => err ? reject(err) : resolve(data)))

const isFile = path =>
  new Promise((resolve, reject) => fs.stat(path, (err, stats) => err ? reject(err) : resolve(stats.isFile())))

const responseWithCharset = async (file, ctx) => {

  var r = false

  try {

    var fd = await openFile(file, 'r')
    var data = await readFile(fd)
    var charset = data.toString(charset).indexOf('�') != -1 ? 'gbk' : 'utf-8'

    ctx.type =  ctx.type + ';charset=' + charset
    ctx.body = data

    r = true

  } catch (e) {
  } finally {
    if (fd) fs.close(fd)
  }

  return r
}

const responseAsStream = async (file, ctx) => {

  var r = false

  try {

    if (await isFile(file)) {
      var fd = await openFile(file, 'r')
      ctx.body = fs.createReadStream(file, {fd})

      r = true
    }

  } catch (e) {
    if (fd) fs.close(fd)
  }

  return r
}

const proxyTo = (serverConfig, ctx) => {

  var url = serverConfig.proxy_pass

  ctx.respond = false

  if (!url) {
    return ecstatic({
      root: serverConfig.root,
      showDotfiles: false,
      autoIndex: false
    })(ctx.req, ctx.res)
  }

  if (!/^http(s)?:\/\//.test(url)) {
    url = ctx.protocol + '://' + url
  }

  proxy.web(ctx.req, ctx.res, {
    target: url
  })
}

app.use(async (ctx, next) => {
  ctx.configFilePath = configFilePath
  ctx.set('Access-Control-Allow-Origin', '*')
  ctx.set('server', 'SohuTv-FE/node')
  await next()
})

app.use(async (ctx, next) => {

  var hostname = ctx.hostname
  var serverConfig

  config.servers.some(item => !!(serverConfig = item.name == hostname ? item : false))

  if (!serverConfig) {
    ctx.status = 404
    return ctx.body = 'no server:' + hostname
  }

  if (ctx.method === 'POST') {
    return proxyTo(serverConfig, ctx)
  }

  var path = ctx.path
  if (typeof serverConfig.rewrite === 'function') {
    path = serverConfig.rewrite(path)
  }

  var extname = PATH.extname(path).toLowerCase()

  //ctx.type = mime[extname]
  mime[extname] && ctx.set('Content-Type', mime[extname])

  var filePath = PATH.join(serverConfig.root, path)
  var originFilePath = PATH.join(serverConfig.root, ctx.path)

  var reg = new RegExp('^' + serverConfig.root)

  if (!reg.test(filePath) || !reg.test(originFilePath)) {
    ctx.status = 403
    return ctx.body = 'path is unavailable'
  }

  var files = filePath === originFilePath ? [filePath] : [filePath, originFilePath]

  var respond = ['.js'].indexOf(extname) != -1 ? responseWithCharset : responseAsStream

  var responsed = false
  for (var file of files) {
    if (responsed = await respond(file, ctx)) break
  }

  if (!responsed) {
    return proxyTo(serverConfig, ctx)
  }
})

http.createServer(app.callback()).listen(port, host)

https.createServer({

  key: fs.readFileSync(PATH.join(__dirname, './sslkey/a1.itc.cn_server.key')),
  cert: fs.readFileSync(PATH.join(__dirname, './sslkey/a1.itc.cn.cer'))

}, app.callback()).listen(443, host)
