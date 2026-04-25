import * as cdk from 'aws-cdk-lib';
import * as ec2  from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export class VpcStack extends cdk.Stack {
  public readonly vpc:     ec2.Vpc;
  public readonly sgAlb:   ec2.SecurityGroup;
  public readonly sgEcs:   ec2.SecurityGroup;
  public readonly sgRds:   ec2.SecurityGroup;
  public readonly sgRedis: ec2.SecurityGroup;
  public readonly sgEfs:   ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Sem NAT Gateway — ECS em subnets públicas (pull ECR via IP público)
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'Public',   subnetType: ec2.SubnetType.PUBLIC,           cidrMask: 24 },
        { name: 'Isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    this.sgAlb = new ec2.SecurityGroup(this, 'SgAlb', {
      vpc: this.vpc, description: 'ALB public', allowAllOutbound: true,
    });
    this.sgAlb.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80),  'HTTP');
    this.sgAlb.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS');

    this.sgEcs = new ec2.SecurityGroup(this, 'SgEcs', {
      vpc: this.vpc, description: 'ECS tasks', allowAllOutbound: true,
    });
    this.sgEcs.addIngressRule(this.sgAlb, ec2.Port.allTraffic(), 'From ALB');

    this.sgRds = new ec2.SecurityGroup(this, 'SgRds', {
      vpc: this.vpc, description: 'RDS from ECS', allowAllOutbound: false,
    });
    this.sgRds.addIngressRule(this.sgEcs, ec2.Port.tcp(5432), 'Postgres from ECS');

    this.sgRedis = new ec2.SecurityGroup(this, 'SgRedis', {
      vpc: this.vpc, description: 'Redis from ECS', allowAllOutbound: false,
    });
    this.sgRedis.addIngressRule(this.sgEcs, ec2.Port.tcp(6379), 'Redis from ECS');

    this.sgEfs = new ec2.SecurityGroup(this, 'SgEfs', {
      vpc: this.vpc, description: 'EFS from ECS', allowAllOutbound: false,
    });
    this.sgEfs.addIngressRule(this.sgEcs, ec2.Port.tcp(2049), 'NFS from ECS');

    new cdk.CfnOutput(this, 'VpcId',          { value: this.vpc.vpcId });
    new cdk.CfnOutput(this, 'PublicSubnet1',   { value: this.vpc.publicSubnets[0].subnetId });
    new cdk.CfnOutput(this, 'SgEcsId',         { value: this.sgEcs.securityGroupId });
  }
}
