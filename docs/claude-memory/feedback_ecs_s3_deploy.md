---
name: ECS/S3/Deploy — lições críticas de infraestrutura
description: Erros graves cometidos em abril/2026 que nunca devem se repetir — ECS sem S3, email sem normalização, workflow não commitado, Docker cache, task definition desatualizada
type: feedback
originSessionId: 70201c53-e120-4e84-a6d1-e96d8946598d
---
Nunca assumir que containers ECS compartilham filesystem. Nunca salvar dado de identidade sem normalizar. Nunca deixar workflow de CI/CD fora do git. Nunca assumir que force-new-deployment troca a imagem.

**Why:** Erros evitáveis causaram horas de debug em produção em 2026-04-20 com zero valor entregue.

**How to apply:**

1. **ECS containers são isolados** — API e Worker NUNCA compartilham `/tmp` ou qualquer path local. Todo arquivo que precisa cruzar containers vai para S3 (`genomaflow-uploads-prod`). Ao implementar qualquer feature que envolva arquivos, perguntar imediatamente: "qual container vai ler isso?"

2. **Email (e qualquer campo de identidade) deve ser normalizado antes de persistir** — `.toLowerCase().trim()` no register; `LOWER(col) = $1` no login. Sem isso o usuário não consegue autenticar com as credenciais que cadastrou.

3. **O arquivo `.github/workflows/deploy.yml` deve estar commitado no git** — sem ele, nenhum push dispara CI/CD e produção nunca atualiza. Verificar se está tracked ANTES de assumir que deploys automáticos funcionam.

4. **Antes de debugar em produção, verificar o que está realmente rodando** — checar imagem do ECS vs latest do ECR:
   ```bash
   # Imagem rodando no ECS:
   aws ecs describe-task-definition --task-definition <arn> \
     --query 'taskDefinition.containerDefinitions[0].image'
   # Últimas imagens no ECR:
   aws ecr describe-images --repository-name genomaflow/web \
     --query 'sort_by(imageDetails,&imagePushedAt)[-3:].{tags:imageTags,digest:imageDigest,pushed:imagePushedAt}'
   ```

5. **Novo serviço AWS = nova permissão IAM na task role** — sem isso o container falha em produção com AccessDenied ou ENOENT silencioso.

6. **`force-new-deployment` NÃO troca a imagem** — reinicia o serviço com a MESMA task definition, que está pinada no digest antigo. Para trocar a imagem é obrigatório: (a) registrar nova revisão da task definition com a nova imagem, (b) depois `update-service --task-definition <nova-arn>`. O workflow já faz isso automaticamente.

7. **Docker layer cache pode silenciosamente reutilizar imagem antiga** — Todos os Dockerfiles têm `ARG CACHEBUST` antes do `COPY src`. O CI passa `--build-arg CACHEBUST=<git-sha>` garantindo que a camada de código fonte seja sempre reconstruída. Nunca remover esse padrão.

8. **Para confirmar que a imagem deployada tem o código novo**, pull e inspecione:
   ```bash
   aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account>.dkr.ecr.us-east-1.amazonaws.com
   docker run --rm <image> grep -rl "termo_novo" /usr/share/nginx/html/
   ```
