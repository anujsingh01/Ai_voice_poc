# Containers on ECS Fargate: the web app (2+ tasks behind the load balancer, auto-scaling), the
# scoring worker, the maintenance worker, and a one-off migration task run by the deploy pipeline.

resource "aws_ecr_repository" "app" {
  for_each             = toset(["web", "jobs"])
  name                 = "${local.name}/${each.key}"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration { scan_on_push = true }
  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.data.arn
  }
}

resource "aws_ecs_cluster" "main" {
  name = local.name
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "app" {
  # checkov:skip=CKV_AWS_338: 90 days on purpose (data minimisation); the audit log in the database is kept longer
  for_each          = toset(["web", "scoring", "maintenance", "messages", "migrate"])
  name              = "/${local.name}/${each.key}"
  retention_in_days = 90
  kms_key_id        = aws_kms_key.data.arn
}

# ---------- IAM ----------

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Used by ECS itself: pull images, write logs, read the secrets into the container environment.
resource "aws_iam_role" "execution" {
  name               = "${local.name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = concat([for s in aws_secretsmanager_secret.generated : s.arn], [aws_secretsmanager_secret.openai.arn], aws_secretsmanager_secret.gupshup[*].arn, [for s in aws_secretsmanager_secret.razorpay : s.arn]) },
      { Effect = "Allow", Action = ["kms:Decrypt"], Resource = [aws_kms_key.data.arn] },
    ]
  })
}

# Used by the app code: only the audio bucket, nothing else.
resource "aws_iam_role" "task" {
  name               = "${local.name}-app"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy" "task_s3" {
  role = aws_iam_role.task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], Resource = ["${aws_s3_bucket.audio.arn}/tenants/*"] },
      { Effect = "Allow", Action = ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey"], Resource = [aws_kms_key.data.arn] },
    ]
  })
}

# ---------- Task definitions ----------

locals {
  app_env = concat(local.messaging_env, local.billing_env, [
    { name = "NODE_ENV", value = "production" },
    { name = "APP_ENV", value = var.env },
    { name = "APP_URL", value = "https://${var.domain}" },
    { name = "STORAGE_DRIVER", value = "s3" },
    { name = "S3_BUCKET", value = aws_s3_bucket.audio.bucket },
    { name = "AWS_REGION", value = var.region },
    { name = "DATABASE_SSL", value = "verify-full" },
    { name = "OPENAI_MODEL", value = "gpt-5-mini" },
  ])
  app_secrets = concat(local.messaging_secrets, local.billing_secrets,
    [for k, env in {
      "database-url"        = "DATABASE_URL"
      "redis-url"           = "REDIS_URL"
      "data-encryption-key" = "DATA_ENCRYPTION_KEY"
      "health-token"        = "HEALTH_TOKEN"
    } : { name = env, valueFrom = aws_secretsmanager_secret.generated[k].arn }],
    [{ name = "OPENAI_API_KEY", valueFrom = aws_secretsmanager_secret.openai.arn }],
  )
  image = { for k, r in aws_ecr_repository.app : k => "${r.repository_url}:${var.image_tag}" }
  log = { for k, g in aws_cloudwatch_log_group.app : k => {
    logDriver = "awslogs"
    options   = { "awslogs-group" = g.name, "awslogs-region" = var.region, "awslogs-stream-prefix" = k }
  } }
}

resource "aws_ecs_task_definition" "web" {
  family                   = "${local.name}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 1024
  memory                   = 2048
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }
  container_definitions = jsonencode([{
    name                   = "web"
    image                  = local.image["web"]
    essential              = true
    readonlyRootFilesystem = false
    portMappings           = [{ containerPort = 3000 }]
    environment            = concat(local.app_env, [{ name = "DATABASE_POOL", value = "15" }])
    secrets                = local.app_secrets
    logConfiguration       = local.log["web"]
  }])
}

resource "aws_ecs_task_definition" "job" {
  for_each                 = { scoring = "scripts/scoring-worker.mts", maintenance = "scripts/maintenance-worker.mts", messages = "scripts/message-worker.mts", migrate = "scripts/migrate.mts" }
  family                   = "${local.name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  container_definitions = jsonencode([{
    name             = each.key
    image            = local.image["jobs"]
    essential        = true
    command          = [each.value]
    environment      = local.app_env
    secrets          = each.key == "migrate" ? concat(local.app_secrets, [{ name = "DATABASE_ADMIN_URL", valueFrom = aws_secretsmanager_secret.generated["database-admin-url"].arn }]) : local.app_secrets
    logConfiguration = local.log[each.key]
  }])
}

# ---------- Services ----------

resource "aws_ecs_service" "web" {
  name                              = "web"
  cluster                           = aws_ecs_cluster.main.id
  task_definition                   = aws_ecs_task_definition.web.arn
  desired_count                     = var.web_desired_count
  launch_type                       = "FARGATE"
  health_check_grace_period_seconds = 30
  deployment_circuit_breaker {
    enable   = true
    rollback = true # a release that fails its health checks rolls itself back
  }
  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.app.id]
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3000
  }
  lifecycle { ignore_changes = [desired_count] } # owned by auto-scaling
}

# Workers restart automatically if they crash (ECS keeps desired_count running).
resource "aws_ecs_service" "worker" {
  for_each        = toset(["scoring", "maintenance", "messages"])
  name            = each.key
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.job[each.key].arn
  desired_count   = 1
  launch_type     = "FARGATE"
  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.app.id]
  }
}

resource "aws_appautoscaling_target" "web" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.web.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.web_desired_count
  max_capacity       = var.web_max_count
}

resource "aws_appautoscaling_policy" "web_cpu" {
  name               = "${local.name}-web-cpu"
  service_namespace  = aws_appautoscaling_target.web.service_namespace
  resource_id        = aws_appautoscaling_target.web.resource_id
  scalable_dimension = aws_appautoscaling_target.web.scalable_dimension
  policy_type        = "TargetTrackingScaling"
  target_tracking_scaling_policy_configuration {
    target_value = 60
    predefined_metric_specification { predefined_metric_type = "ECSServiceAverageCPUUtilization" }
  }
}
