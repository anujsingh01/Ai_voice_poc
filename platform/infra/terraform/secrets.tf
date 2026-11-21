# Every secret lives in Secrets Manager and reaches containers as environment variables at start;
# none are in code, images or Terraform variables. Values Terraform can't know (the OpenAI key) are
# created empty and filled in once from the console:
#   aws secretsmanager put-secret-value --secret-id interview-production/openai-api-key --secret-string '...'

resource "random_password" "health_token" {
  length  = 64
  special = false
}

resource "random_bytes" "data_key" {
  length = 32
}

locals {
  db_host = aws_db_instance.main.address
  generated_secrets = {
    "database-url"        = "postgres://app_user:${random_password.db_app.result}@${local.db_host}:5432/interview"
    "database-admin-url"  = "postgres://postgres_admin:${random_password.db_master.result}@${local.db_host}:5432/interview"
    "redis-url"           = "rediss://default:${random_password.redis.result}@${aws_elasticache_replication_group.main.primary_endpoint_address}:6379"
    "data-encryption-key" = random_bytes.data_key.base64
    "health-token"        = random_password.health_token.result
  }
}

resource "aws_secretsmanager_secret" "generated" {
  # checkov:skip=CKV2_AWS_57: rotated by Terraform (taint the random_* resource) per docs/runbook.md
  for_each   = local.generated_secrets
  name       = "${local.name}/${each.key}"
  kms_key_id = aws_kms_key.data.arn
}

resource "aws_secretsmanager_secret_version" "generated" {
  for_each      = local.generated_secrets
  secret_id     = aws_secretsmanager_secret.generated[each.key].id
  secret_string = each.value
}

resource "aws_secretsmanager_secret" "openai" {
  # checkov:skip=CKV2_AWS_57: OpenAI keys are rotated by hand in the OpenAI dashboard
  name       = "${local.name}/openai-api-key"
  kms_key_id = aws_kms_key.data.arn
}
