import * as cdk from 'aws-cdk-lib';
import { EcrStack }   from '../lib/ecr-stack';
import { DnsStack }   from '../lib/dns-stack';
import { VpcStack }   from '../lib/vpc-stack';
import { RdsStack }   from '../lib/rds-stack';
import { RedisStack } from '../lib/redis-stack';
import { EcsStack }   from '../lib/ecs-stack';

const app = new cdk.App();

if (!process.env.CDK_DEFAULT_ACCOUNT) {
  throw new Error(
    'CDK_DEFAULT_ACCOUNT não definido.\n' +
    'Execute: export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)'
  );
}

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region:  process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

// 1. ECR — repositórios de imagens (deploy uma vez)
const ecr = new EcrStack(app, 'genomaflow-ecr', { env });

// 2. DNS — zona Route53 (deploy primeiro; depois configure nameservers no registro.br)
const dns = new DnsStack(app, 'genomaflow-dns', { env });

// 3. VPC — rede base
const vpc = new VpcStack(app, 'genomaflow-vpc', { env });

// 4. RDS — PostgreSQL 15 + pgvector
const rds = new RdsStack(app, 'genomaflow-rds', { env, vpc: vpc.vpc, sgRds: vpc.sgRds });

// 5. Redis — ElastiCache
const redis = new RedisStack(app, 'genomaflow-redis', { env, vpc: vpc.vpc, sgRedis: vpc.sgRedis });

// 6. ECS — cluster, serviços, ALB, certificado ACM, Route53 aliases
new EcsStack(app, 'genomaflow-ecs', {
  env,
  vpc:           vpc.vpc,
  sgAlb:         vpc.sgAlb,
  sgEcs:         vpc.sgEcs,
  sgEfs:         vpc.sgEfs,
  apiRepo:       ecr.apiRepo,
  workerRepo:    ecr.workerRepo,
  webRepo:       ecr.webRepo,
  rdsSecret:     rds.secret,
  rdsEndpoint:   rds.endpoint,
  redisEndpoint: redis.endpoint,
  hostedZone:    dns.hostedZone,
});

app.synth();
