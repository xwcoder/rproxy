const PATH = require('path')
const fs = require('fs')
const mime = require('./lib/mime')
const httpProxy = require('http-proxy')
const Koa = require('koa')

const proxy = httpProxy.createProxyServer()
const app = new Koa()

const {configFilePath, config} = (x => {

  var args = process.argv.slice(2)

  var configFilePath = args[0] || './config'

  if (/^[^\.\/]/.test(configFilePath)) {
    configFilePath = './' + configFilePath
  }

  var config = require(configFilePath);

  return {config, configFilePath}

})()

const openFile = (path, flag) => {

  return new Promise((resolve, reject) => {
    fs.open(path, flag, (err, fd) => {
      if (err) {
        reject(err)
      } else {
        resolve(fd)
      }
    })
  })
}

const readFile = (file, options) => {

  return new Promise((resolve, reject) => {
    fs.readFile(file, options, (err, data) => {
      if (err) {
        reject(err)
      } else {
        resolve(data)
      }
    })
  })
}

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
    if (fd) {
      fs.close(fd)
    }
  }

  return r
}

const responseAsStream = async (file, ctx) => {

  var r = false

  try {

    var fd = openFile(filePath, 'r')
    ctx.body = fs.createReadStream(null, {fd})

    r = true
  } catch (e) {
  } finally {
    if (fd) {
      fs.close(fd)
    }
  }
}

const proxyToHttp = (serverConfig, ctx) => {

  var url = serverConfig.proxy_pass
  if (!url) {
    return ctx.status(405);
  }

  ctx.respond = false

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
  await next()
})

app.use(async (ctx, next) => {

  var hostname = ctx.hostname
  var serverConfig

  config.servers.some(item => {
    if (item.name == hostname) {
      serverConfig = item
      return true
    }
  })

  if (!serverConfig) {
    ctx.status = 404
    return ctx.body = 'no server:' + hostname
  }

  if (ctx.method === 'POST') {
    return proxyToHttp(serverConfig, ctx)
  }

  var path = ctx.path
  if (typeof serverConfig.rewrite === 'function') {
    path = serverConfig.rewrite(path)
  }

  var extname = PATH.extname(path).toLowerCase()

  ctx.type = mime[extname]

  var filePath = PATH.join(serverConfig.root, path)
  var originFilePath = PATH.join(serverConfig.root, ctx.path)

  var files = filePath === originFilePath ? [filePath] : [filePath, originFilePath]

  var respond = ['.js'].indexOf(extname) != -1 ? responseWithCharset : responseAsStream

  for (var file of files) {
    var responsed = await respond(file, ctx)
    if (responsed) {
      break
    }
  }

  if (!responsed) {
    return proxyToHttp(serverConfig, ctx)
  }

})

if (config.host) {
  app.listen(config.port || 80, config.host);
} else {
  app.listen(config.port || 80);
}
