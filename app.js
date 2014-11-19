var http = require( 'http' );
var URL = require( 'url' );
var PATH = require( 'path' );
var fs = require( 'fs' );
var mime = require( './mime' );
var MessageBus = require( './messagebus' );

//var config = require( './config/config2.js' );

var config;
var args = process.argv.slice( 2 );

if ( args[ 0 ] ) {
    var configPath = args[ 0 ];
    if ( /^[^\.\/]/.test( configPath ) ) {
        configPath = './' + configPath;
    }
    config = require( configPath );
} else {
    config = require( './config' );
}

var app = {

    config: config,

    parseUrl: function ( url ) {
        var url = URL.parse( url );
        url.extname = PATH.extname( url.pathname )

        return url;
    },

    responseConcatFile: function ( req, res, serverConfig, urlInfo ) {

        var pathname = urlInfo.pathname;
        if ( typeof serverConfig.rewrite == 'function' ) {
            pathname = serverConfig.rewrite( pathname, req );
        }
        
        var contentType = mime[ urlInfo.extname ];
        var mb = new MessageBus();
        var files = serverConfig.concatFile[ pathname ];
        
        var files = files.map( function ( file ) {
            return PATH.join( serverConfig.root, file );
        } );

        var array = [];
        var hasError = false;

        mb.wait( files, function () {

            res.writeHead( 200, { 'content-type' : contentType } );
            array.forEach( function ( data ) {
                res.write( data );
            } );
            res.end();
        } );

        files.forEach( function ( file, index ) {
            
            fs.readFile( file, function ( err, data ) {

                if ( hasError ) {
                    return;
                }

                if ( err ) {
                    hasError = true;
                    app.responseSingleFile( req, res, serverConfig, urlInfo );
                } else {
                    array[ index ] = data;
                    mb.publish( file );
                }
            } );
        } );
    },

    responseSingleFile: function ( req, res, serverConfig, urlInfo ) {

        var contentType = mime[ urlInfo.extname ];
        var originFile = PATH.join( serverConfig.root, urlInfo.pathname );

        var filename = urlInfo.pathname;

        if ( typeof serverConfig.rewrite == 'function' ) {
            filename = serverConfig.rewrite( filename, req );
        }

        filename = PATH.join( serverConfig.root, filename );

        var extname = PATH.extname( filename ).toLowerCase();

        var readbleExts = [ '.js' ];

        if ( readbleExts.indexOf( extname ) != -1 ) { //全部读到内存中再response

            fs.open( filename, 'r', function ( err, fd ) {
                if ( err ) {
                    if ( filename == originFile ) {
                        app.proxyTo( req, res, serverConfig );
                    } else {
                        fs.open( originFile, 'r', function ( err, fd ) {

                            if ( err ) {
                                app.proxyTo( req, res, serverConfig );
                            } else {

                                fs.readFile( originFile, function ( err, data ) {

                                    if ( err ) {
                                        app.proxyTo( req, res, serverConfig );
                                    } else {

                                        var charset = 'utf-8';
                                        if ( data.toString( charset ).indexOf( '�' ) != -1 ) {
                                            charset = 'gbk';
                                        }
                                        contentType = contentType + ';charset=' + charset;

                                        res.writeHead( 200, { 'content-type' : contentType } );
                                        res.end( data, 'binary' );
                                        fs.close( fd );
                                    }

                                } );
                            }

                        } );
                    }
                } else {
                    
                    fs.readFile( filename, function ( err, data ) {

                        if ( err ) {
                            app.proxyTo( req, res, serverConfig );
                        } else {

                            var charset = 'utf-8';
                            if ( data.toString( charset ).indexOf( '�' ) != -1 ) {
                                charset = 'gbk';
                            }
                            contentType = contentType + ';charset=' + charset;

                            res.writeHead( 200, { 'content-type' : contentType } );
                            res.end( data, 'binary' );
                            fs.close( fd );
                        }

                    } );
                }

            } );

        } else { //用流的方式response

            fs.open( filename, 'r', function ( err, fd ) {

                var stream;

                if ( err ) {
                    if ( filename == originFile ) {
                        app.proxyTo( req, res, serverConfig );
                    } else {
                        fs.open( originFile, 'r', function ( err, fd ) {
                            if ( err ) {
                                app.proxyTo( req, res, serverConfig );
                            } else {
                                res.writeHead( 200, { 'content-type' : contentType } );

                                stream = fs.createReadStream( filename );
                                stream.on( 'data', function ( data ) {
                                    res.write( data );
                                } );

                                stream.on( 'end', function () {
                                    res.end();
                                    fs.close( fd );
                                } );
                            }
                        } );
                    }
                } else {

                    res.writeHead( 200, { 'content-type' : contentType } );

                    stream = fs.createReadStream( filename );
                    stream.on( 'data', function ( data ) {
                        res.write( data );
                    } );

                    stream.on( 'end', function () {
                        res.end();
                        fs.close( fd );
                    } );
                }

            } );
        }
    },

    proxyTo: function ( req, res, serverConfig ) {
    
        if ( !serverConfig.proxy_pass ) {
            res.writeHead( 404, { 'content-type' : 'text/plain' } );
            res.end( 'not found: no proxy_pass_server' );
        }

        var headers = req.headers;
        
        headers[ 'x-forwarded-for' ] = req.connection.remoteAddress;
        headers[ 'if-modified-since' ] = ( new Date( 1970, 0, 1 ) ).toUTCString();

        // {connection:keep-alive}可以造成ECONNRESET
        // https://github.com/nodejitsu/node-http-proxy/issues/579
        // https://github.com/nodejitsu/node-http-proxy/pull/488
        // https://github.com/nodejitsu/node-http-proxy/issues/496
        delete headers.connection;

        var proxyRequest = http.request( {
            host : serverConfig.proxy_pass,
            port : serverConfig.port || 80,
            method : req.method,
            path : req.url,
            headers : req.headers

        }, function ( proxyResponse ) {
            
            var headers = proxyResponse.headers;
            headers[ 'Expires' ] = -1;

            res.writeHead( proxyResponse.statusCode, headers );

            proxyResponse.on( 'data', function ( data ) {
                res.write( data, 'binary' );
            } );
            
            proxyResponse.on( 'end', function () {
                res.end();    
            } );

            proxyResponse.on( 'error', function () {
                res.end();    
            } );

        } );
        
        proxyRequest.on( 'error', function () {
            res.writeHead( 500, { 'content-type' : 'text/plain' } );
            res.end( 'Error to request' );
        } );
        
        if ( req.method == 'POST' ) {
            if ( req.rawBody ) {
                proxyRequest.end( req.rawBody );
            } else {
                req.on( 'end', function () {
                    proxyRequest.end( req.rawBody );
                } );
            }
        } else {
            proxyRequest.end();
        }
    },

    handler: function ( req, res ) {

        if ( req.method == 'POST' ) {

            var data = new Buffer( '' );

            req.on( 'data', function ( chunk ) {
                data = Buffer.concat( [ data, chunk ] );
            } );

            req.on( 'end', function () {
                req.rawBody = data;
            } );
        }

        var config = app.config;
        var host = req.headers.host.split( ':' )[ 0 ];    

        var serverConfig;

        config.servers.every( function ( item ) {
            if ( item.name == host ) {
                serverConfig = item;
                return false;
            }
            return true;
        } );
        
        if ( !serverConfig ) {
            res.writeHead( 500, { 'content-type' : 'text/plain' } );
            res.end( 'no server' );
            return;
        }

        var urlInfo = app.parseUrl( req.url );
        var pathname = urlInfo.pathname;

        if ( typeof serverConfig.rewrite == 'function' ) {
            pathname = serverConfig.rewrite( pathname, req );
        }

        urlInfo.extname = PATH.extname( pathname );

        if ( !mime[ urlInfo.extname ] ) {
            app.proxyTo( req, res, serverConfig );
            return;
        }

        if ( serverConfig.concatFile && serverConfig.concatFile[ pathname ] ) {
            app.responseConcatFile( req, res, serverConfig, urlInfo );
        } else {
            app.responseSingleFile( req, res, serverConfig, urlInfo );
        }
    },

    init: function () {

        var config = this.config;

        this.server = http.createServer( this.handler.bind( this ) );

        if ( config.host ) {
            this.server.listen( config.port || 80, config.host );
        } else {
            this.server.listen( config.port || 80 );
        }

        this.server.on( 'clientError', function ( err, socket ) {
            console.log( new Date() );
            console.log( err );
            console.log( err.stack );
            socket.destroy();
        } );

        if ( config.pid ) {
            fs.writeFile( config.pid, process.pid );
        }
        console.log( 'listening on \d', config.port || 80 );
    }
};

app.init();
