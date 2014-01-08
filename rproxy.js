var http = require( 'http' );
var url = require( 'url' );
var path = require( 'path' );
var fs = require( 'fs' );
//var config = require( './config' );
var mime = require( './mime' );

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
        res.end( 'not found ' + req.url );
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
        res.end( 'Error to request ' + host + req.url );
    } );

    proxyRequest.end();
};

var proxyServer = http.createServer( function ( req, res ) {
    var host = req.headers.host;    
    var server;
    config.servers.every( function ( item ) {
        if ( item.name == host ) {
            server = item;
            return false;
        }
        return true;
    } );
    
    if ( !server ) {
        res.writeHead( 500, { 'content-type' : 'text/plain' } );
        res.end( 'Error to find ' + host );
        return;
    }

    var pathname = url.parse( req.url ).pathname;
    var ext = path.extname( pathname );
    ext && ( ext = ext.split( '.' )[ 1 ] );

    var contentType = mime[ ext ];
    if ( !contentType ) {
        proxyTo( server, req, res );
        return;
    }

    var originFile = path.join( server.root, pathname );
    var filename = originFile;

    if ( typeof server.rewrite == 'function' ) {
        filename = server.rewrite( filename, pathname, req );
    }

    fs.open( filename, 'r', function ( err, fd ) {
        if ( err ) {
            fs.open( originFile, 'r', function ( err, fd ) {
                if ( err ) {
                    proxyTo( server, req, res );
                } else {
                    fs.readFile( originFile, function ( err, data ) {
                        if ( err ) {
                            proxyTo( server, req, res );
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
            //proxyTo( server, req, res );
        } else {
            fs.readFile( filename, function ( err, data ) {
                if ( err ) {
                    proxyTo( server, req, res );
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
} );

if ( config.host ) {
    proxyServer.listen( config.port || 80, config.host );
} else {
    proxyServer.listen( config.port || 80 );
}

process.on( 'uncaughtException', function () {} );

if ( config.pid ) {
    fs.writeFile( config.pid, process.pid );
}
