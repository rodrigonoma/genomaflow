import * as cdk            from 'aws-cdk-lib';
import * as ec2            from 'aws-cdk-lib/aws-ec2';
import * as rds            from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

interface Props extends cdk.StackProps {
  vpc:   ec2.Vpc;
  sgRds: ec2.SecurityGroup;
}

export class RdsStack extends cdk.Stack {
  public readonly secret:   secretsmanager.ISecret;
  public readonly endpoint: string;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    const instance = new rds.DatabaseInstance(this, 'Postgres', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15,
      }),
      // t3.micro — mínimo custo (~$15/mês)
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [props.sgRds],
      databaseName: 'genomaflow',
      credentials: rds.Credentials.fromGeneratedSecret('genomaflow', {
        secretName: '/genomaflow/prod/rds-credentials',
      }),
      // Single-AZ na Onda 2 de redução de custo (2026-06-01) — economiza ~50%
      // do custo RDS. Trade-off: perdemos failover automático (RTO ~10min via
      // restore de snapshot vs <60s de Multi-AZ). Snapshot diário + 7 dias de
      // retenção dão PITR pra recovery; risco de downtime extendido em caso
      // de falha de AZ é aceito pra MVP. Reativar Multi-AZ assim que tiver
      // SLA de uptime contratado com clientes que justifique +USD 20/mês.
      multiAz: false,
      allocatedStorage: 20,
      storageType: rds.StorageType.GP2,
      backupRetention: cdk.Duration.days(30),
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      // Parâmetros para habilitar pgvector
      parameterGroup: new rds.ParameterGroup(this, 'PgParams', {
        engine: rds.DatabaseInstanceEngine.postgres({
          version: rds.PostgresEngineVersion.VER_15,
        }),
        parameters: { 'shared_preload_libraries': 'pg_stat_statements' },
      }),
    });

    this.secret   = instance.secret!;
    this.endpoint = instance.instanceEndpoint.hostname;

    new cdk.CfnOutput(this, 'RdsEndpoint',  { value: this.endpoint });
    new cdk.CfnOutput(this, 'RdsSecretArn', { value: this.secret.secretArn });
  }
}
