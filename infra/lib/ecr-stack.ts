import * as cdk from 'aws-cdk-lib';
import * as ecr  from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';

export class EcrStack extends cdk.Stack {
  public readonly apiRepo:    ecr.Repository;
  public readonly workerRepo: ecr.Repository;
  public readonly webRepo:    ecr.Repository;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const repo = (name: string) => new ecr.Repository(this, name, {
      repositoryName:      `genomaflow/${name.toLowerCase()}`,
      removalPolicy:       cdk.RemovalPolicy.RETAIN,
      imageTagMutability:  ecr.TagMutability.MUTABLE,
      lifecycleRules: [{ maxImageCount: 5, description: 'Keep last 5' }],
    });

    this.apiRepo    = repo('Api');
    this.workerRepo = repo('Worker');
    this.webRepo    = repo('Web');

    new cdk.CfnOutput(this, 'ApiRepoUri',    { value: this.apiRepo.repositoryUri });
    new cdk.CfnOutput(this, 'WorkerRepoUri', { value: this.workerRepo.repositoryUri });
    new cdk.CfnOutput(this, 'WebRepoUri',    { value: this.webRepo.repositoryUri });
  }
}
