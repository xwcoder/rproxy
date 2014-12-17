var http = require( 'http' );
var url = require( 'url' );
var path = require( 'path' );
var fs = require( 'fs' );
var mime = require( './mime' );

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

var proxyTo = function ( server, req, res ) {
    
    if ( !server.proxy_pass ) {
        res.writeHead( 404, { 'content-type' : 'text/plain' } );
        res.end( 'not found' );
    }
    req.headers[ 'x-forwarded-for' ] = req.connection.remoteAddress;
    req.headers[ 'if-modified-since' ] = ( new Date( 1970, 0, 1 ) ).toUTCString();

    var proxyRequest = http.request( {
        host : server.proxy_pass,
        port : server.port || 80,
        method : req.method,
        path : url.parse( req.url ).pathname,
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
    ext && ( ext = ext.split( '.' )[ 1 ] );

    var contentType = mime[ ext ];

    var originFile = path.join( serverConfig.root, pathname );
    var filename = originFile;

    if ( typeof serverConfig.rewrite == 'function' ) {
        filename = serverConfig.rewrite( filename, req );
    }

    var fileContent;

    try {

        fileContent = fs.readFileSync( filename );

        if ( ext == '.js' ) {
            var charset = 'utf-8';
            if ( fileContent.toString( charset ).indexOf( '�' ) != -1 ) {
                charset = 'gbk';
            }
            contentType = contentType + ';charset=' + charset;
        }
        res.writeHead( 200, { 'content-type' : contentType } );
        res.end( fileContent, 'binary' );

    } catch ( ex ) {

        try {

            fileContent = fs.readFileSync( originFile );
            if ( ext == '.js' ) {
                var charset = 'utf-8';
                if ( fileContent.toString( charset ).indexOf( '�' ) != -1 ) {
                    charset = 'gbk';
                }
                contentType = contentType + ';charset=' + charset;
            }
            res.writeHead( 200, { 'content-type' : contentType } );
            res.end( fileContent, 'binary' );

        } catch ( ex ) {

            proxyTo( serverConfig, req, res );
        }
    }
};

var loadConcatFile = function ( serverConfig, pathnames, req, res ) {

    var filenames = pathnames.map( function ( pathname ) {
        return path.join( serverConfig.root, pathname );
    } );
    
    try {
        var bufferArray = [];

        filenames.forEach( function ( filename, index ) {
            bufferArray.push( fs.readFileSync( filename ) );
        } );
        
        var pathname = url.parse( req.url ).pathname;
        var ext = path.extname( pathname );
        ext && ( ext = ext.split( '.' )[ 1 ] );

        var contentType = mime[ ext ];

        if ( ext == '.js' ) {
            var charset = 'utf-8';
            if ( bufferArray[ 0 ].toString( charset ).indexOf( '�' ) != -1 ) {
                charset = 'gbk';
            }
            contentType = contentType + ';charset=' + charset;
        }

        res.writeHead( 200, { 'content-type' : contentType } );
        bufferArray.forEach( function ( data ) {
            res.write( data );
        } );

        res.end();

    } catch ( ex ) {
        proxyTo( serverConfig, req, res );
    }
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
    if ( typeof serverConfig.rewrite == 'function' ) {
        pathname = serverConfig.rewrite( pathname, req );
    }

    var ext = path.extname( pathname );
    ext && ( ext = ext.split( '.' )[ 1 ] );

    var contentType = mime[ ext ];
    if ( !contentType ) {
        proxyTo( serverConfig, req, res );
        return;
    }

    if ( serverConfig.concatFile && serverConfig.concatFile[ pathname ] ) {
        loadConcatFile( serverConfig, serverConfig.concatFile[ pathname ], req, res );
    } else {
        loadFile( serverConfig, req, res );
    }

} );

if ( config.host ) {
    proxyServer.listen( config.port || 80, config.host );
} else {
    proxyServer.listen( config.port || 80 );
}

if ( config.pid ) {
    fs.writeFile( config.pid, process.pid );
}
