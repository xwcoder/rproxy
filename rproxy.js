var http = require( 'http' );
var url = require( 'url' );
var path = require( 'path' );
var fs = require( 'fs' );
var config = require( './config' );
var mime = require( './mime' );

var proxyTo = function ( server, req, res ) {

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
        res.writeHead( 500, { 'content-type' : 'text/plain' } );
        res.end( 'Error: 不支持文件类型 ' + ext );
        return;
    }

    var filename = path.join( server.root, pathname );

    if ( typeof server.rewrite == 'function' ) {
        filename = server.rewrite( filename, pathname, req );
    }

    fs.open( filename, 'r', function ( err, fd ) {
        if ( err ) {
            proxyTo( server, req, res );
        } else {
            fs.readFile( filename, function ( err, data ) {
                if ( err ) {
                    proxyTo( server, req, res );
                    return;
                }

                var charset = 'utf-8';
                if ( data.toString( charset ).indexOf( '�' ) != -1 ) {
                    charset = 'gbk';
                }
                res.writeHead( 200, { 'content-type' : contentType + ';charset=' + charset } );
                res.end( data, 'binary' );
            } );
        }
    } );

} );

proxyServer.listen( config.port || 80 );

process.on( 'uncaughtException', function () {} );
