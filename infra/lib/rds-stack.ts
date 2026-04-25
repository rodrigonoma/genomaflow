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
      multiAz: false,
      allocatedStorage: 20,
      storageType: rds.StorageType.GP2,
      backupRetention: cdk.Duration.days(0),
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
