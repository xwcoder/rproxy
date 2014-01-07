var path = require( 'path' );
module.exports = {
    host : '192.168.1.103',
    pid : '/Users/xwcoder/code/rproxy/config.pid',
    servers : [
        {
            name : 'js.tv.itc.cn',
            root : '/Users/xwcoder/code/tv/js',
            proxy_pass : '61.135.181.167',
            rewrite : function ( filename, req ) {

                if ( /\S+?(_\d+).js$/.test( filename ) ) {
                    return filename.replace( RegExp.$1, '' );
                }

                if ( /\S+?(\d+).js$/.test( filename ) ) {
                    return filename.replace( RegExp.$1, '' );
                }

                if ( /\S+(_\S+).js$/.test( filename ) ) {
                    return filename.replace( RegExp.$1, '' );
                }

                return filename;
            }
        },
        {
            name : 'css.tv.itc.cn',
            root : '/Users/xwcoder/code/tv/css',
            proxy_pass : '61.135.181.167'
        },
        {
            name : 'img.tv.itc.cn',
            root : '/home/xwcoder/code/tv/img',
            proxy_pass : '61.135.181.167'
        },
        {
            name : 'tv.sohu.com',
            root : '/home/xwcoder/code/sohu',
            proxy_pass : '61.135.132.59',
            rewrite : function ( filename ) {

                if ( path.extname( filename ) == '.js' && !/\.src\./i.test( filename ) ) {
                    filename = filename.replace( /^(.+)(\.js)$/, '$1.src$2' );
                }

                return filename;
            }
        }
    ]
};
