/**
 * 设置代码版本
 */

const aws = require('aws-sdk')
const loadConfig = require('../util/load-config')
const allowApiInvocation = require('../aws/allow-api-invocation')
const retriableWrap = require('../util/retriable-wrap')
const entityWrap = require('../util/entity-wrap')
const readEnvVarsFromOptions = require('../util/read-env-vars-from-options')
const updateEnvVars = require('../util/update-env-vars')
const apiGWUrl = require('../util/api-url')
const NullLogger = require('../util/null-logger')
const markAlias = require('../util/mark-alias')
const getOwnerInfo = require('../aws/get-own-info')

module.exports = function setVersion(options, optionalLogger) {
    let lambdaConfig, lambda, apiGateway, apiConfig
    const logger = optionalLogger || new NullLogger()
    
    const updateApi = function () {
        return getOwnerInfo(options.region, logger)
            .then(ownerInfo => allowApiInvocation(lambdaConfig.name, options.version, apiConfig.id, ownerInfo.account, ownerInfo.partition, lambdaConfig.region))
            .then(() => apiGateway.createDeploymentPromise({
                restApiId: apiConfig.id,
                stageName: options.version,
                variables: {
                    lambdaVersion: options.version
                }
            }))
            .then(() => ({url: apiGWUrl(apiConfig.id, lambdaConfig.region, options.version)}))
    }
    const updateConfiguration = function () {
        logger.logStage('更新配置')
        return Promise.resolve()
            .then(() => lambda.getFunctionConfiguration({FunctionName: lambdaConfig.name}).promise())
            .then(functionConfiguration => updateEnvVars(options, lambda, lambdaConfig.name, functionConfiguration.Environment && functionConfiguration.Environment.variables))
    }

    if (!options.version) { 
        return Promise.reject('版本信息未指定，请使用 --version 指定版本')
    }
    try {
        readEnvVarsFromOptions(options)
    } catch (e) {
        return Promise.reject(e)
    }

    logger.logStage('加载配置')
    return  loadConfig(options, {lambda: {name: true, region: true}})
        .then(config => {
            lambdaConfig = config.lambda
            apiConfig = config.api
            lambda = entityWrap(new aws.Lambda({region: lambdaConfig.region}), {log: logger.logApiCall, logName: 'lambda'})
            apiGateway = retriableWrap(
                entityWrap(
                    new aws.APIGateway({region: lambdaConfig.region}),
                    {log: logger.logApiCall, logName: 'apigateway'}
                ),
                () => logger.logStage('AWS限制速率， 稍后重试')
            )
        })
        .then(updateConfiguration)
        .then(() => {
            logger.logStage('更新版本')
            return lambda.publishVersion({FunctionName: lambdaConfig.name}).promise()
        })
        .then(versionResult => markAlias(lambdaConfig.name, lambda, versionResult.Version, options.version))
        .then(() => {
            if (apiConfig && apiConfig.id) {
                return updateApi()
            }
        })
}

module.exports.doc = {
	description: 'Create or update a lambda alias/api stage to point to the latest deployed version',
	priority: 3,
	args: [
		{
			argument: 'version',
			description: 'the alias to update or create',
			example: 'production'
		},
		{
			argument: 'source',
			optional: true,
			description: 'Directory with project files',
			default: 'current directory'
		},
		{
			argument: 'config',
			optional: true,
			description: 'Config file containing the resource names',
			default: 'claudia.json'
		},
		{
			argument: 'update-env',
			optional: true,
			example: 'S3BUCKET=testbucket,SNSQUEUE=testqueue',
			description: 'comma-separated list of VAR=VALUE environment variables to set, merging with old variables'
		},
		{
			argument: 'set-env',
			optional: true,
			example: 'S3BUCKET=testbucket,SNSQUEUE=testqueue',
			description: 'comma-separated list of VAR=VALUE environment variables to set. replaces the whole set, removing old variables.'
		},
		{
			argument: 'update-env-from-json',
			optional: true,
			example: 'production-env.json',
			description: 'file path to a JSON file containing environment variables to set, merging with old variables'
		},

		{
			argument: 'set-env-from-json',
			optional: true,
			example: 'production-env.json',
			description: 'file path to a JSON file containing environment variables to set. replaces the whole set, removing old variables.'
		},
		{
			argument: 'env-kms-key-arn',
			optional: true,
			description: 'KMS Key ARN to encrypt/decrypt environment variables'
		}
	]
}