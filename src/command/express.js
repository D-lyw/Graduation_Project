/**
 * 为express应用创建Lambda代理api
 */

const path = require('path')
const fsPromise = require('fs').promises
const fsUtil = require('../util/fs-utils')
const runNpm = require('../util/run-npm')
const NullLogger = require('../util/null-logger')


module.exports = function generateServerlessExpressProxy(options, optionalLogger) {
    const source = (options && options.source) || process.cwd()
    const logger = optionalLogger || new NullLogger()
    const serverlessModule = (options && options['aws-serverless-express-module']) || 'aws-serverless-express'
    const proxyModuleName = (options && options['proxy-module-name']) || 'lambda'
    const proxyModulePath = path.join(source, `${proxyModuleName}.js`)
    const expressModule = options && options['express-module']
    
    const installDependencies = targetDir => runNpm(targetDir, ['install', serverlessModule, '-S'], logger)

    if (!expressModule) {
        return Promise.reject(`请使用 --express-module 指定express应用模块`)
    }
    if (!fsUtil.fileExists(path.join(source, expressModule + '.js'))) {
        return Promise.reject(`目标目录下不包含 ${expressModule}.js`)
    }
    if (!fsUtil.fileExists(path.join(source, 'package.json'))) {
        return Promise.reject(`目标路径不是一个node.js项目`)
    }
    if (fsUtil.fileExists('-e', proxyModulePath)) {
        return Promise.reject(`${proxyModuleName}.js已经存在目标目录下`)
    }
    if (proxyModuleName.indexOf('/') >= 0) {
        return Promise.reject(`${proxyModuleName}.js 不能在一个子目录下`)
    }

    return installDependencies(source)
        .then(() => {
            const contents = `'use strict'
                const awsServerlessExpress = require('aws-serverless-express')
                const app = require('./${expressModule}')
                const binaryMimeTypes = [
                    'application/octet-stream',
                    'font/eot',
                    'font/opentype',
                    'font/otf',
                    'image/jpeg',
                    'image/png',
                    'image/svg+xml'
                ]
                const server = awsServerlessExpress.createServer(app, null, binaryMimeTypes);
                exports.handler = (event, context) => awsServerlessExpress.proxy(server, event, context)
                `
            return fsPromise.writeFile(proxyModulePath, contents, 'utf8')
        })
        .then(() => ({
            'lambda-handler': proxyModuleName + '.handler'
        }))
}

module.exports.doc = {
	description: 'Create a lambda proxy API wrapper for an express app using aws-serverless-express',
	priority: 20,
	args: [
		{
			argument: 'express-module',
			description: 'The main module that exports your express application',
			example: 'if the application is defined and exported from express-server.js, this would be express-server'
		},
		{
			argument: 'source',
			optional: true,
			description: 'Directory with project files',
			'default': 'current directory'
		},
		{
			argument: 'proxy-module-name',
			optional: true,
			description: 'the name of the new proxy module/file that will be created. To create a file called web-lambda.js, this would be web-lambda',
			default: 'lambda'
		},
		{
			argument: 'aws-serverless-express-module',
			optional: true,
			description: 'the NPM module name/path of the serverless-express module you want to install',
			default: 'aws-serverless-express'
		}
	]
}