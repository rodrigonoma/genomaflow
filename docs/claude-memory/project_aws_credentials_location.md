# AWS Credentials — Local Dev

**Location:** `C:\Projetos\Genomaflow\genomaflow\aws\credentials`

Arquivo no formato AWS shared credentials (`[default]` + `aws_access_key_id` + `aws_secret_access_key`). Estáticas (não-SSO), não expiram.

Identidade: `arn:aws:iam::981207388012:user/auditty-deploy` (conta `981207388012`, região default `us-east-1`).

## Como usar

**Bash (1-shot):**
```bash
AWS_SHARED_CREDENTIALS_FILE=/c/Projetos/Genomaflow/genomaflow/aws/credentials aws <comando>
```

**Bash (sessão):**
```bash
export AWS_SHARED_CREDENTIALS_FILE=/c/Projetos/Genomaflow/genomaflow/aws/credentials
```

**PowerShell:**
```powershell
$env:AWS_SHARED_CREDENTIALS_FILE = "C:\Projetos\Genomaflow\genomaflow\aws\credentials"
```

CDK / SDK / CLI tudo lê `AWS_SHARED_CREDENTIALS_FILE` automaticamente.

## Por que não em `~/.aws/`

Usuário optou por manter dentro do projeto. Esse path É a fonte da verdade — não criar/copiar pra `~/.aws/`. Pasta `aws/` é gitignored (sensitive).

## Quando re-usar

Qualquer comando que precise de credenciais AWS — `aws logs tail`, `aws ecs describe-services`, `cdk deploy`, `aws ssm get-parameter`, etc. Setar a env var antes de invocar. Não pedir credenciais ao usuário, não tentar SSO — é só apontar pra esse arquivo.
