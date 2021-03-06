/**
 * 添加S3服务事件触发
 */

const aws = require('aws-sdk')
const loadConfig = require('../util/load-config')
const iamNameSanitize = require('../util/iamNameSanitize')

module.exports = function addS3EventSource(options) {
    let lambdaConfig,
        awsPartition,
        lambda;
    const ts = Date.now()
    const getLambda = function (config) {
        lambda = new aws.Lambda({region: config.lambda.region})
        lambdaConfig = config.lambda
        return lambda.getFunctionConfiguration({FunctionName: lambdaConfig.name, Qualifier: options.version}).promise()
    }
    const readConfig = function () {
        return loadConfig(options, {lambda: {name: true, region: true, role: true}})
            .then(config => {
                lambdaConfig = config 
                return config
            })
            .then(getLambda)
            .then(result => {
                lambdaConfig.arn = result.FunctionArn
                awsPartition = result.FunctionArn.split(':')[1]
                lambdaConfig.version = result.Version
            })
    }
    const addS3AccessPolicy = function () {
        const iam = new aws.IAM({region: lambdaConfig.region})
        return iam.putRolePolicy({
            RoleName: lambdaConfig.role,
            PolicyName: iamNameSanitize(`s3-${options.bucket}-access-${ts}`),
            PolicyDocument: JSON.stringify({
                'Version': '2012-10-17',
					'Statement': [
						{
							'Effect': 'Allow',
							'Action': [
								's3:*'
							],
							'Resource': [
								`arn:${awsPartition}:s3:::${options.bucket}/*`
							]
						}
					]
            })
        }).promise()
    }
    const addInvokePermission = function () {
        return lambda.addPermission({
            Action: 'lambda:InvokeFunction',
			FunctionName: lambdaConfig.name,
			Principal: 's3.amazonaws.com',
			SourceArn: `arn:${awsPartition}:s3:::${options.bucket}`,
			Qualifier: options.version,
			StatementId: iamNameSanitize(`${options.bucket}-access-${ts}`)
        })
    }
    const addBucketNotificationConfig = function () {
        const events = options.events ? options.events.split(',') :  ['s3:ObjectCreated:*']
        const s3 = new aws.S3({region: lambdaConfig.region, signatureVersion: 'v4'})
        const eventConfig = {
            LambdaFunctionArn: lambdaConfig.arn,
            Events: events
        }
        const filterRules = []
        if (options.prefix) {
            filterRules.push({
                Name: 'prefix',
                Value: options.prefix
            })
        }
        if (options.suffix) {
            filterRules.push({
                Name: 'suffix',
                Value: options.suffix
            })
        }
        if (filterRules.length) {
            eventConfig.Filter = {
                Key: {
                    FilterRules: filterRules
                }
            }
        }
        return s3.getBucketNotificationConfiguration({
            Bucket: options.bucket
        }).promise()
        .then(currentConfig => {
            const merged = currentConfig || {}
            if (!merged.LambdaFunctionConfigurations) {
                merged.LambdaFunctionConfigurations = []
            }
            merged.LambdaFunctionConfigurations.push(eventConfig)
            return s3.putBucketNotificationConfiguration({
                Bucket: options.bucket,
                NotificationConfiguration: merged
            }).promise()
        })
    }

    if (!options.bucket) {
        return Promise.reject('没有指定 bucket 桶的名称，请使用 --bucket 指定')
    }
    return readConfig()
        .then(addS3AccessPolicy)
        .then(addInvokePermission)
        .then(addBucketNotificationConfig)
}

module.exports.doc = {
	description: '将文件添加到S3存储桶中，向Lambda添加通知事件，设置访问权限',
	priority: 5,
	args: [
		{
			argument: 'bucket',
			description: 'S3存储桶名称，它将通知发送到Lambda'
		},
		{
			argument: 'prefix',
			optional: true,
			description: '设置触发事件的S3键的前缀过滤器',
			example: 'infiles/'
		},
		{
			argument: 'suffix',
			optional: true,
			description: '设置触发事件的S3键的后缀过滤器',
			example: '.jpg'
		},
		{
			argument: 'version',
			optional: true,
			description: '绑定一个特定的版本',
			example: 'production',
		},
		{
			argument: 'source',
			optional: true,
			description: '指定项目文件目录',
			default: 'current directory'
		},
		{
			argument: 'config',
			optional: true,
			description: '指定配置文件名称',
			default: 'sln.json'
		},
		{
			argument: 'events',
			optional: true,
			description: '逗号分隔的触发函数的事件类型列表',
			example: 's3:ObjectCreated:*,s3:ObjectRemoved:*',
			default: 's3:ObjectCreated:*'
		}
	]
}