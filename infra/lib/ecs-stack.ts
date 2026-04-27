import * as cdk            from 'aws-cdk-lib';
import * as ec2            from 'aws-cdk-lib/aws-ec2';
import * as ecs            from 'aws-cdk-lib/aws-ecs';
import * as ecr            from 'aws-cdk-lib/aws-ecr';
import * as efs            from 'aws-cdk-lib/aws-efs';
import * as elbv2          from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as acm            from 'aws-cdk-lib/aws-certificatemanager';
import * as route53        from 'aws-cdk-lib/aws-route53';
import * as route53targets from 'aws-cdk-lib/aws-route53-targets';
import * as iam            from 'aws-cdk-lib/aws-iam';
import * as logs           from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm            from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

interface Props extends cdk.StackProps {
  vpc:           ec2.Vpc;
  sgAlb:         ec2.SecurityGroup;
  sgEcs:         ec2.SecurityGroup;
  sgEfs:         ec2.SecurityGroup;
  apiRepo:       ecr.Repository;
  workerRepo:    ecr.Repository;
  webRepo:       ecr.Repository;
  rdsSecret:     secretsmanager.ISecret;
  rdsEndpoint:   string;
  redisEndpoint: string;
  hostedZone:    route53.HostedZone;
}

export class EcsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    const {
      vpc, sgAlb, sgEcs, sgEfs,
      apiRepo, workerRepo, webRepo,
      rdsSecret, rdsEndpoint, redisEndpoint, hostedZone,
    } = props;

    // ── ACM Certificate (DNS validation via Route53 — requer NS já propagados) ──
    const certificate = new acm.Certificate(this, 'Cert', {
      domainName:              'genomaflow.com.br',
      subjectAlternativeNames: ['*.genomaflow.com.br'],
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    // ── SSM SecureString — criados com placeholder; ATUALIZE antes do primeiro deploy ──
    // aws ssm put-parameter --name /genomaflow/prod/jwt-secret --value "SEU_JWT_SECRET" --type SecureString --overwrite
    // aws ssm put-parameter --name /genomaflow/prod/anthropic-api-key --value "sk-ant-..." --type SecureString --overwrite
    // aws ssm put-parameter --name /genomaflow/prod/openai-api-key --value "sk-..." --type SecureString --overwrite
    const ssmParam = (name: string) =>
      ssm.StringParameter.fromSecureStringParameterAttributes(this, name, {
        parameterName: `/genomaflow/prod/${name}`,
      });

    const jwtSecret      = ssmParam('jwt-secret');
    const anthropicKey   = ssmParam('anthropic-api-key');
    const openaiKey      = ssmParam('openai-api-key');

    // ── EFS — armazenamento compartilhado para uploads de PDFs ──
    const fileSystem = new efs.FileSystem(this, 'Uploads', {
      vpc,
      securityGroup:   sgEfs,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode:  efs.ThroughputMode.BURSTING,
      removalPolicy:   cdk.RemovalPolicy.RETAIN,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    const efsAccessPoint = new efs.AccessPoint(this, 'UploadsAP', {
      fileSystem,
      path: '/uploads',
      createAcl:  { ownerGid: '1000', ownerUid: '1000', permissions: '755' },
      posixUser:  { uid: '1000', gid: '1000' },
    });

    // ── CloudWatch log group ──
    const logGroup = new logs.LogGroup(this, 'Logs', {
      logGroupName:  '/genomaflow/prod',
      retention:     logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ── IAM roles ──
    const executionRole = new iam.Role(this, 'ExecRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });
    // Permissão para ler SSM SecureString e Secrets Manager
    executionRole.addToPolicy(new iam.PolicyStatement({
      actions:   ['ssm:GetParameters', 'secretsmanager:GetSecretValue', 'kms:Decrypt'],
      resources: ['*'],
    }));

    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // S3 — uploads de exames + anexos de chat inter-tenant + comunicados master.
    // Sem isso, qualquer rota que faça uploadFile() retorna AccessDenied.
    // Ver feedback_iam_s3_prefixes.md (incidente 2026-04-25).
    taskRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:PutObject', 's3:GetObject', 's3:DeleteObject'],
      resources: [
        'arn:aws:s3:::genomaflow-uploads-prod/uploads/*',
        'arn:aws:s3:::genomaflow-uploads-prod/inter-tenant-chat/*',
        'arn:aws:s3:::genomaflow-uploads-prod/master-broadcasts/*',
      ],
    }));

    // ── ECS Cluster ──
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      clusterName:                    'genomaflow',
      containerInsights:              false, // desligado para economizar
      enableFargateCapacityProviders: true,
    });

    const redisUrl = `redis://${redisEndpoint}:6379`;

    // Helper para environment vars comuns (API + Worker)
    const backendEnv = {
      NODE_ENV:                     'production',
      REDIS_URL:                    redisUrl,
      API_PREFIX:                   '/api',
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
      // Domínio do app — usado em emails (verificação, reset de senha) e
      // redirects. Trocado de genomaflow.com.br pra app.genomaflow.com.br
      // após split de subdomínios (apex agora serve só landing).
      FRONTEND_URL:                 'https://app.genomaflow.com.br',
      SES_FROM_EMAIL:               'noreply@genomaflow.com.br',
    };

    const backendSecrets = {
      JWT_SECRET:        ecs.Secret.fromSsmParameter(jwtSecret),
      ANTHROPIC_API_KEY: ecs.Secret.fromSsmParameter(anthropicKey),
      OPENAI_API_KEY:    ecs.Secret.fromSsmParameter(openaiKey),
      DB_HOST:           ecs.Secret.fromSecretsManager(rdsSecret, 'host'),
      DB_PORT:           ecs.Secret.fromSecretsManager(rdsSecret, 'port'),
      DB_NAME:           ecs.Secret.fromSecretsManager(rdsSecret, 'dbname'),
      DB_USER:           ecs.Secret.fromSecretsManager(rdsSecret, 'username'),
      DB_PASSWORD:       ecs.Secret.fromSecretsManager(rdsSecret, 'password'),
    };

    // Volume EFS para uploads
    const efsVol: ecs.Volume = {
      name: 'uploads',
      efsVolumeConfiguration: {
        fileSystemId:        fileSystem.fileSystemId,
        transitEncryption:   'ENABLED',
        authorizationConfig: { accessPointId: efsAccessPoint.accessPointId, iam: 'DISABLED' },
      },
    };

    // ── Task Definition: API ──
    const apiTask = new ecs.FargateTaskDefinition(this, 'ApiTask', {
      memoryLimitMiB: 1024,
      cpu:            512,
      executionRole,
      taskRole,
      volumes: [efsVol],
    });

    const apiContainer = apiTask.addContainer('api', {
      image:       ecs.ContainerImage.fromEcrRepository(apiRepo, 'latest'),
      environment: { ...backendEnv, PORT: '3000' },
      secrets:     backendSecrets,
      // DATABASE_URL montada via script de inicialização
      command: [
        'sh', '-c',
        'export DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}" && node src/server.js'
      ],
      portMappings: [{ containerPort: 3000 }],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'api', logGroup }),
      healthCheck: {
        command:     ['CMD-SHELL', 'wget -qO- http://localhost:3000/api/auth/me || exit 0'],
        interval:    cdk.Duration.seconds(30),
        timeout:     cdk.Duration.seconds(5),
        retries:     3,
        startPeriod: cdk.Duration.seconds(60),
      },
    });
    apiContainer.addMountPoints({ containerPath: '/app/uploads', sourceVolume: 'uploads', readOnly: false });

    // ── Task Definition: Worker ──
    const workerTask = new ecs.FargateTaskDefinition(this, 'WorkerTask', {
      memoryLimitMiB: 1024,
      cpu:            512,
      executionRole,
      taskRole,
      volumes: [efsVol],
    });

    const workerContainer = workerTask.addContainer('worker', {
      image:       ecs.ContainerImage.fromEcrRepository(workerRepo, 'latest'),
      environment: backendEnv,
      secrets:     backendSecrets,
      command: [
        'sh', '-c',
        'export DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}" && node src/index.js'
      ],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'worker', logGroup }),
    });
    workerContainer.addMountPoints({ containerPath: '/app/uploads', sourceVolume: 'uploads', readOnly: false });

    // ── Task Definition: Web (nginx) ──
    const webTask = new ecs.FargateTaskDefinition(this, 'WebTask', {
      memoryLimitMiB: 512,
      cpu:            256,
      executionRole,
      taskRole,
    });

    webTask.addContainer('web', {
      image:        ecs.ContainerImage.fromEcrRepository(webRepo, 'latest'),
      portMappings: [{ containerPort: 80 }],
      logging:      ecs.LogDrivers.awsLogs({ streamPrefix: 'web', logGroup }),
      healthCheck: {
        command:     ['CMD-SHELL', 'wget -qO- http://localhost/health || exit 1'],
        interval:    cdk.Duration.seconds(30),
        timeout:     cdk.Duration.seconds(5),
        retries:     3,
        startPeriod: cdk.Duration.seconds(10),
      },
    });

    // ── Task Definition: Migrate (one-off) ──
    const migrateTask = new ecs.FargateTaskDefinition(this, 'MigrateTask', {
      family:         'genomaflow-prod-migrate',
      memoryLimitMiB: 512,
      cpu:            256,
      executionRole,
      taskRole,
    });

    migrateTask.addContainer('migrate', {
      image:       ecs.ContainerImage.fromEcrRepository(apiRepo, 'latest'),
      environment: { NODE_ENV: 'production' },
      secrets:     backendSecrets,
      command: [
        'sh', '-c',
        'export DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}" && node src/db/migrate.js'
      ],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'migrate', logGroup }),
    });

    // ── Task Definition: Reindex Copilot (one-off) ──
    // Re-indexa docs/*.md + CLAUDE.md no namespace 'product_help' de rag_documents.
    // Usa o image do worker (que agora baked-in tem docs/ + CLAUDE.md).
    const reindexHelpTask = new ecs.FargateTaskDefinition(this, 'ReindexHelpTask', {
      family:         'genomaflow-prod-reindex-help',
      memoryLimitMiB: 1024, // indexação gera embeddings em batch — precisa de um pouco de headroom
      cpu:            512,
      executionRole,
      taskRole,
    });

    reindexHelpTask.addContainer('reindex', {
      image:       ecs.ContainerImage.fromEcrRepository(workerRepo, 'latest'),
      environment: {
        NODE_ENV:  'production',
        REPO_ROOT: '/app', // dentro do container, docs/ e CLAUDE.md vivem em /app (baked no Dockerfile)
      },
      secrets:     backendSecrets,
      command: [
        'sh', '-c',
        'export DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}" && node src/rag/reindex-product-help.js'
      ],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'reindex', logGroup }),
    });

    // ── ALB ──
    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing:   true,
      securityGroup:    sgAlb,
      idleTimeout:      cdk.Duration.seconds(300), // WebSocket support
    });

    // Redirect HTTP → HTTPS
    alb.addListener('Http', {
      port:          80,
      defaultAction: elbv2.ListenerAction.redirect({ protocol: 'HTTPS', port: '443', permanent: true }),
    });

    // Target Groups
    const apiTg = new elbv2.ApplicationTargetGroup(this, 'ApiTg', {
      vpc,
      port:         3000,
      protocol:     elbv2.ApplicationProtocol.HTTP,
      targetType:   elbv2.TargetType.IP,
      healthCheck: {
        path:                '/api/auth/me',
        healthyHttpCodes:    '200,401',
        interval:            cdk.Duration.seconds(30),
        healthyThresholdCount: 2,
      },
    });

    const webTg = new elbv2.ApplicationTargetGroup(this, 'WebTg', {
      vpc,
      port:       80,
      protocol:   elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path:                  '/health',
        healthyHttpCodes:      '200',
        interval:              cdk.Duration.seconds(30),
        healthyThresholdCount: 2,
      },
    });

    const httpsListener = alb.addListener('Https', {
      port:          443,
      certificates:  [certificate],
      sslPolicy:     elbv2.SslPolicy.RECOMMENDED_TLS,
      defaultAction: elbv2.ListenerAction.forward([webTg]),
    });

    // Routing host-based (após split landing × app — 2026-04-27):
    //   priority  5: app.genomaflow.com.br + /api/*  → API target group
    //   priority 11: app.genomaflow.com.br + qualquer → Web TG (Angular SPA)
    //   default     : genomaflow.com.br / www.* → Web TG (nginx serve só landing)
    //
    // Priority 11 (e não 10) evita colisão durante CFN deploy quando regra
    // antiga `ApiRoute` (path-only, priority 10) ainda existe — CFN cria as
    // novas antes de deletar as velhas, e priority precisa ser único.
    //
    // O nginx do Web TG distingue por server_name: apex/www serve landing,
    // app.* serve Angular. Bookmarks antigos no apex (ex: /clinic/dashboard)
    // pegam redirect 308 pra app.genomaflow.com.br pelo nginx.
    httpsListener.addAction('ApiRouteOnApp', {
      priority: 5,
      conditions: [
        elbv2.ListenerCondition.hostHeaders(['app.genomaflow.com.br']),
        elbv2.ListenerCondition.pathPatterns(['/api', '/api/*']),
      ],
      action: elbv2.ListenerAction.forward([apiTg]),
    });
    httpsListener.addAction('AppHost', {
      priority: 11,
      conditions: [elbv2.ListenerCondition.hostHeaders(['app.genomaflow.com.br'])],
      action:     elbv2.ListenerAction.forward([webTg]),
    });

    // ── ECS Services ──
    const apiService = new ecs.FargateService(this, 'ApiService', {
      cluster,
      taskDefinition:    apiTask,
      serviceName:       'genomaflow-api',
      desiredCount:      1,
      securityGroups:    [sgEcs],
      assignPublicIp:    true, // necessário sem NAT gateway para pull do ECR
      vpcSubnets:        { subnetType: ec2.SubnetType.PUBLIC },
      circuitBreaker:    { enable: true, rollback: true },
    });
    apiService.attachToApplicationTargetGroup(apiTg);

    new ecs.FargateService(this, 'WorkerService', {
      cluster,
      taskDefinition: workerTask,
      serviceName:    'genomaflow-worker',
      desiredCount:   1,
      securityGroups: [sgEcs],
      assignPublicIp: true,
      vpcSubnets:     { subnetType: ec2.SubnetType.PUBLIC },
      circuitBreaker: { enable: true, rollback: true },
    });

    const webService = new ecs.FargateService(this, 'WebService', {
      cluster,
      taskDefinition: webTask,
      serviceName:    'genomaflow-web',
      desiredCount:   1,
      securityGroups: [sgEcs],
      assignPublicIp: true,
      vpcSubnets:     { subnetType: ec2.SubnetType.PUBLIC },
      circuitBreaker: { enable: true, rollback: true },
    });
    webService.attachToApplicationTargetGroup(webTg);

    // ── Route53 Aliases ──
    const albTarget = new route53targets.LoadBalancerTarget(alb);
    new route53.ARecord(this, 'ARecordApex', {
      zone:       hostedZone,
      recordName: 'genomaflow.com.br',
      target:     route53.RecordTarget.fromAlias(albTarget),
    });
    new route53.ARecord(this, 'ARecordWww', {
      zone:       hostedZone,
      recordName: 'www',
      target:     route53.RecordTarget.fromAlias(albTarget),
    });
    new route53.ARecord(this, 'ARecordApp', {
      zone:       hostedZone,
      recordName: 'app',
      target:     route53.RecordTarget.fromAlias(albTarget),
    });
    new route53.ARecord(this, 'ARecordApi', {
      zone:       hostedZone,
      recordName: 'api',
      target:     route53.RecordTarget.fromAlias(albTarget),
    });

    // ── Outputs ──
    new cdk.CfnOutput(this, 'AlbDns',     { value: alb.loadBalancerDnsName });
    new cdk.CfnOutput(this, 'ClusterArn', { value: cluster.clusterArn });
  }
}
