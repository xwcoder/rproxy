var http = require( 'http' );
var url = require( 'url' );
var path = require( 'path' );
var fs = require( 'fs' );
var mime = require( './mime' );
var MessageBus = require( './messagebus' );

var config;
var args = process.argv.slice( 2 );
if ( args[ 0 ] == '-c' && args[ 1 ] ) {
    var configPath = args[ 1 ];
    if ( /^[^\.\/]/.test( configPath ) ) {
        configPath = './' + configPath;
    }
    config = require( configPath );
} else {
    var config = require( './config' );
}

var proxyTo = function ( server, req, res ) {
    
    if ( !server.proxy_pass ) {
        res.writeHead( 404, { 'content-type' : 'text/plain' } );
        res.end( 'not found' );
    }
    req.headers[ 'x-forwarded-for' ] = req.connection.remoteAddress;

    var proxyRequest = http.request( {
        host : server.proxy_pass,
        port : server.port || 80,
        method : req.method,
        path : url.parse( req.url ).pathname,
        headers : req.headers
    }, function ( proxyResponse ) {

        res.writeHead( proxyResponse.statusCode, proxyResponse.headers );

        proxyResponse.on( 'data', function ( data ) {
            res.write( data, 'binary' );
        } );
        
        proxyResponse.on( 'end', function () {
            res.end();    
        } );

    } );
    
    proxyRequest.on( 'error', function () {
        res.writeHead( 500, { 'content-type' : 'text/plain' } );
        res.end( 'Error to request' );
    } );

    proxyRequest.end();
};

var loadFile = function ( serverConfig, req, res ) {

    var pathname = url.parse( req.url ).pathname;
    var ext = path.extname( pathname );
    var contentType = mime[ ext ];

    var originFile = path.join( serverConfig.root, pathname );
    var filename = originFile;

    if ( typeof serverConfig.rewrite == 'function' ) {
        filename = serverConfig.rewrite( filename, req );
    }

    fs.open( filename, 'r', function ( err, fd ) {
        if ( err ) {
            if ( filename == originFile ) {
                proxyTo( serverConfig, req, res );
            } else { 
                fs.open( originFile, 'r', function ( err, fd ) {
                    if ( err ) {
                        proxyTo( serverConfig, req, res );
                    } else {
                        fs.readFile( originFile, function ( err, data ) {
                            if ( err ) {
                                proxyTo( serverConfig, req, res );
                                return;
                            }

                            var ext = path.extname( originFile ).toLowerCase();
                            if ( ext == '.js' ) {
                                var charset = 'utf-8';
                                if ( data.toString( charset ).indexOf( '�' ) != -1 ) {
                                    charset = 'gbk';
                                }
                                contentType = contentType + ';charset=' + charset;
                            }
                            res.writeHead( 200, { 'content-type' : contentType } );
                            res.end( data, 'binary' );
                            fs.close( fd );
                        } );
                    }
                } );
            }
        } else {
            fs.readFile( filename, function ( err, data ) {
                if ( err ) {
                    proxyTo( serverConfig, req, res );
                    return;
                }

                var ext = path.extname( filename ).toLowerCase();
                if ( ext == '.js' ) {
                    var charset = 'utf-8';
                    if ( data.toString( charset ).indexOf( '�' ) != -1 ) {
                        charset = 'gbk';
                    }
                    contentType = contentType + ';charset=' + charset;
                }
                res.writeHead( 200, { 'content-type' : contentType } );
                res.end( data, 'binary' );
                fs.close( fd );
            } );
        }
    } );
};

var loadConcatFile = function ( serverConfig, pathnames, contentType, req, res ) {
    var mb = new MessageBus();
    var filenames = pathnames.map( function ( pathname ) {
        return path.join( serverConfig.root, pathname );
    } );
    
    var array = [];
    var hasError = false;
    mb.wait( filenames, function () {

        res.writeHead( 200, { 'content-type' : contentType } );
        array.forEach( function ( data ) {
            res.write( data );
        } );
        res.end();
    } )

    filenames.forEach( function ( filename, index ) {
        
        fs.readFile( filename, function ( err, data ) {
            if ( hasError ) {
                return;
            }
            if ( err ) {
                hasError = true;
                loadFile( serverConfig, req, res );
            } else {
                array[ index ] = data;
                mb.publish( filename );
            }
        } );
    } );
    
    //res.write( 'hello world tian' );
    //res.end();
};

var proxyServer = http.createServer( function ( req, res ) {
    var host = req.headers.host;    
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

    var pathname = url.parse( req.url ).pathname;
    var ext = path.extname( pathname );
    ext && ( ext = ext.split( '.' )[ 1 ] );

    var contentType = mime[ ext ];
    if ( !contentType ) {
        proxyTo( serverConfig, req, res );
        return;
    }

    if ( typeof serverConfig.rewrite == 'function' ) {
        pathname = serverConfig.rewrite( pathname, req );
    }

    if ( serverConfig.concatFile && serverConfig.concatFile[ pathname ] ) {
        loadConcatFile( serverConfig, serverConfig.concatFile[ pathname ], contentType, req, res );
    } else {
        loadFile( serverConfig, req, res );
    }
} );

if ( config.host ) {
    proxyServer.listen( config.port || 80, config.host );
} else {
    proxyServer.listen( config.port || 80 );
}

//process.on( 'uncaughtException', function () {} );

if ( config.pid ) {
    fs.writeFile( config.pid, process.pid );
}
