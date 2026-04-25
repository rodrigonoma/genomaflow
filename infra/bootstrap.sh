#!/usr/bin/env bash
# Rode este script UMA VEZ para configurar o ambiente AWS antes do primeiro deploy.
# Pré-requisitos: aws CLI configurado com usuário admin, Node.js 20+
set -euo pipefail

REGION="us-east-1"

echo "=== GenomaFlow — Bootstrap AWS ==="
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export CDK_DEFAULT_REGION=$REGION
echo "Account: $CDK_DEFAULT_ACCOUNT | Region: $REGION"

# Instalar dependências da infra
cd "$(dirname "$0")"
npm install

# CDK Bootstrap (necessário uma vez por conta/região)
npx cdk bootstrap aws://$CDK_DEFAULT_ACCOUNT/$REGION

# PASSO 1 — Criar repositórios ECR
echo ""
echo "=== PASSO 1: Criando ECR ==="
npx cdk deploy genomaflow-ecr --require-approval never

# PASSO 2 — Criar zona DNS no Route53
echo ""
echo "=== PASSO 2: Criando zona DNS ==="
npx cdk deploy genomaflow-dns --require-approval never

echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║  ⚠️   AÇÃO NECESSÁRIA — CONFIGURE O REGISTRO.BR                  ║"
echo "╠══════════════════════════════════════════════════════════════════╣"
echo "║  Acesse https://registro.br e altere os nameservers do domínio  ║"
echo "║  genomaflow.com.br para os 4 nameservers listados acima         ║"
echo "║  (output 'NameServers' do stack genomaflow-dns).                ║"
echo "║                                                                  ║"
echo "║  Aguarde a propagação DNS (geralmente 1–6 horas).               ║"
echo "║  Depois rode: ./bootstrap.sh --continue                         ║"
echo "╚══════════════════════════════════════════════════════════════════╝"

if [[ "${1:-}" != "--continue" ]]; then
  exit 0
fi

# PASSO 3 — Criar VPC, RDS e Redis
echo ""
echo "=== PASSO 3: Criando VPC, RDS e Redis ==="
npx cdk deploy genomaflow-vpc genomaflow-rds genomaflow-redis --require-approval never

RDS_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name genomaflow-rds \
  --query 'Stacks[0].Outputs[?OutputKey==`RdsEndpoint`].OutputValue' \
  --output text)

echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║  ⚠️   CRIE OS PARÂMETROS SSM COM SEUS VALORES REAIS              ║"
echo "╠══════════════════════════════════════════════════════════════════╣"
echo "║  Execute os comandos abaixo com seus valores:                   ║"
echo "║                                                                  ║"
echo "║  aws ssm put-parameter \\                                        ║"
echo "║    --name /genomaflow/prod/jwt-secret \\                         ║"
echo "║    --value \"SEU_JWT_SECRET_AQUI\" \\                              ║"
echo "║    --type SecureString --overwrite                               ║"
echo "║                                                                  ║"
echo "║  aws ssm put-parameter \\                                        ║"
echo "║    --name /genomaflow/prod/anthropic-api-key \\                  ║"
echo "║    --value \"sk-ant-...\" \\                                       ║"
echo "║    --type SecureString --overwrite                               ║"
echo "║                                                                  ║"
echo "║  aws ssm put-parameter \\                                        ║"
echo "║    --name /genomaflow/prod/openai-api-key \\                     ║"
echo "║    --value \"sk-...\" \\                                           ║"
echo "║    --type SecureString --overwrite                               ║"
echo "║                                                                  ║"
echo "║  RDS endpoint: $RDS_ENDPOINT"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""
read -p "Parâmetros SSM criados? [s/N] " yn
if [[ "$yn" != "s" && "$yn" != "S" ]]; then
  echo "Rode novamente após criar os parâmetros SSM."
  exit 0
fi

# PASSO 4 — Criar cluster ECS, ALB, certificado ACM
echo ""
echo "=== PASSO 4: Criando ECS + ALB + ACM (aguarda validação do cert ~2-5 min) ==="
npx cdk deploy genomaflow-ecs --require-approval never

# PASSO 5 — Criar usuário IAM para GitHub Actions
echo ""
echo "=== PASSO 5: Criando usuário IAM para GitHub Actions ==="
aws iam create-user --user-name genomaflow-github-actions 2>/dev/null || echo "Usuário já existe"

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

aws iam put-user-policy \
  --user-name genomaflow-github-actions \
  --policy-name genomaflow-deploy \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [
      {
        \"Effect\": \"Allow\",
        \"Action\": [
          \"ecr:GetAuthorizationToken\",
          \"ecr:BatchCheckLayerAvailability\",
          \"ecr:GetDownloadUrlForLayer\",
          \"ecr:PutImage\",
          \"ecr:InitiateLayerUpload\",
          \"ecr:UploadLayerPart\",
          \"ecr:CompleteLayerUpload\",
          \"ecr:BatchGetImage\"
        ],
        \"Resource\": \"*\"
      },
      {
        \"Effect\": \"Allow\",
        \"Action\": [
          \"ecs:UpdateService\",
          \"ecs:DescribeServices\",
          \"ecs:ListTaskDefinitions\",
          \"ecs:RunTask\",
          \"ecs:DescribeTasks\",
          \"ecs:ListTasks\"
        ],
        \"Resource\": \"*\"
      },
      {
        \"Effect\": \"Allow\",
        \"Action\": [
          \"iam:PassRole\"
        ],
        \"Resource\": \"arn:aws:iam::${ACCOUNT_ID}:role/genomaflow-*\"
      },
      {
        \"Effect\": \"Allow\",
        \"Action\": [
          \"cloudformation:DescribeStacks\"
        ],
        \"Resource\": \"*\"
      },
      {
        \"Effect\": \"Allow\",
        \"Action\": [
          \"logs:GetLogEvents\"
        ],
        \"Resource\": \"*\"
      }
    ]
  }"

ACCESS_KEY=$(aws iam create-access-key --user-name genomaflow-github-actions)
KEY_ID=$(echo $ACCESS_KEY | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['AccessKey']['AccessKeyId'])")
SECRET=$(echo $ACCESS_KEY | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['AccessKey']['SecretAccessKey'])")

echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║  ✅  CONFIGURE ESTES SECRETS NO GITHUB                           ║"
echo "║  Repositório → Settings → Secrets → Actions                     ║"
echo "╠══════════════════════════════════════════════════════════════════╣"
echo "║  AWS_ACCESS_KEY_ID     = $KEY_ID"
echo "║  AWS_SECRET_ACCESS_KEY = $SECRET"
echo "║  AWS_ACCOUNT_ID        = $ACCOUNT_ID"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""
echo "✅ Bootstrap concluído! O próximo push na branch main fará deploy automático."
