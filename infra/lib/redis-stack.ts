import * as cdk         from 'aws-cdk-lib';
import * as ec2         from 'aws-cdk-lib/aws-ec2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import { Construct } from 'constructs';

interface Props extends cdk.StackProps {
  vpc:     ec2.Vpc;
  sgRedis: ec2.SecurityGroup;
}

export class RedisStack extends cdk.Stack {
  public readonly endpoint: string;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    const subnetGroup = new elasticache.CfnSubnetGroup(this, 'SubnetGroup', {
      description: 'GenomaFlow Redis',
      subnetIds:   props.vpc.isolatedSubnets.map(s => s.subnetId),
    });

    const cluster = new elasticache.CfnReplicationGroup(this, 'Redis', {
      replicationGroupDescription: 'GenomaFlow Redis',
      engine:        'redis',
      engineVersion: '7.1',
      // cache.t3.micro — mínimo custo (~$12/mês)
      cacheNodeType:            'cache.t3.micro',
      numCacheClusters:         1,
      automaticFailoverEnabled: false,
      cacheSubnetGroupName:     subnetGroup.ref,
      securityGroupIds:         [props.sgRedis.securityGroupId],
      atRestEncryptionEnabled:  true,
      transitEncryptionEnabled: false,
    });

    cluster.addDependency(subnetGroup);

    this.endpoint = cluster.attrPrimaryEndPointAddress;

    new cdk.CfnOutput(this, 'RedisUrl', {
      value: `redis://${cluster.attrPrimaryEndPointAddress}:6379`,
    });
  }
}
