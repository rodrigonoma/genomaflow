import * as cdk     from 'aws-cdk-lib';
import * as route53  from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';

/**
 * Cria apenas a hosted zone do Route53.
 * Após o deploy, copie os NameServers do output e configure-os no registro.br.
 * O certificado ACM é criado no EcsStack (após propagação dos NS).
 */
export class DnsStack extends cdk.Stack {
  public readonly hostedZone: route53.HostedZone;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.hostedZone = new route53.HostedZone(this, 'Zone', {
      zoneName: 'genomaflow.com.br',
    });

    new cdk.CfnOutput(this, 'NameServers', {
      value:       cdk.Fn.join(', ', this.hostedZone.hostedZoneNameServers!),
      description: '⚠️  Configure estes 4 nameservers no registro.br antes de deployar o EcsStack',
    });

    new cdk.CfnOutput(this, 'HostedZoneId', { value: this.hostedZone.hostedZoneId });
  }
}
