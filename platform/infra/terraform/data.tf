# PostgreSQL (RDS), Redis (ElastiCache) and the audio bucket (S3), all encrypted with one KMS key.

resource "aws_kms_key" "data" {
  description         = "${local.name} data at rest"
  enable_key_rotation = true
  # The account administers the key (IAM policies then decide who uses it); CloudWatch Logs needs an
  # explicit grant to encrypt the log groups in this region.
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AccountAdministers"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        Sid       = "CloudWatchLogs"
        Effect    = "Allow"
        Principal = { Service = "logs.${var.region}.amazonaws.com" }
        Action    = ["kms:Encrypt", "kms:Decrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:Describe*"]
        Resource  = "*"
        Condition = { ArnLike = { "kms:EncryptionContext:aws:logs:arn" = "arn:aws:logs:${var.region}:${data.aws_caller_identity.current.account_id}:log-group:*" } }
      },
    ]
  })
}

resource "aws_kms_alias" "data" {
  name          = "alias/${local.name}-data"
  target_key_id = aws_kms_key.data.key_id
}

# ---------- PostgreSQL ----------

resource "random_password" "db_master" {
  length  = 40
  special = false
}

resource "random_password" "db_app" {
  length  = 40
  special = false
}

resource "aws_db_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_parameter_group" "pg18" {
  name   = "${local.name}-pg18"
  family = "postgres18"
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  parameter {
    name  = "log_min_duration_statement"
    value = "500"
  }
}

resource "aws_db_instance" "main" {
  identifier                      = local.name
  engine                          = "postgres"
  engine_version                  = "18"
  instance_class                  = var.db_instance_class
  allocated_storage               = var.db_allocated_storage_gb
  max_allocated_storage           = var.db_allocated_storage_gb * 4
  storage_type                    = "gp3"
  storage_encrypted               = true
  kms_key_id                      = aws_kms_key.data.arn
  db_name                         = "interview"
  username                        = "postgres_admin"
  password                        = random_password.db_master.result
  db_subnet_group_name            = aws_db_subnet_group.main.name
  vpc_security_group_ids          = [aws_security_group.data.id]
  parameter_group_name            = aws_db_parameter_group.pg18.name
  multi_az                        = local.production
  backup_retention_period         = local.production ? 30 : 7 # daily snapshots + point-in-time recovery
  backup_window                   = "20:30-21:00"             # 02:00 IST
  maintenance_window              = "sun:21:30-sun:22:30"
  deletion_protection             = local.production
  skip_final_snapshot             = !local.production
  final_snapshot_identifier       = "${local.name}-final"
  performance_insights_enabled    = true
  performance_insights_kms_key_id = aws_kms_key.data.arn
  enabled_cloudwatch_logs_exports = ["postgresql"]
  monitoring_interval             = 60
  monitoring_role_arn             = aws_iam_role.rds_monitoring.arn
  # checkov:skip=CKV_AWS_161: the app authenticates with a password from Secrets Manager
  # checkov:skip=CKV_AWS_157: Multi-AZ is on in production; staging is single-AZ to save cost
  # checkov:skip=CKV_AWS_293: deletion protection is on in production; staging is disposable
  auto_minor_version_upgrade = true
  copy_tags_to_snapshot      = true
}

resource "aws_iam_role" "rds_monitoring" {
  name = "${local.name}-rds-monitoring"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "monitoring.rds.amazonaws.com" } }]
  })
}

resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  role       = aws_iam_role.rds_monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

# ---------- Redis ----------

resource "random_password" "redis" {
  length  = 48
  special = false
}

resource "aws_elasticache_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_elasticache_replication_group" "main" {
  # checkov:skip=CKV2_AWS_50: automatic failover is on in production; staging runs one node
  replication_group_id       = local.name
  description                = "Rate limits and 2FA replay protection"
  engine                     = "valkey" # open-source Redis successor; same protocol, lower price on ElastiCache
  engine_version             = "9.1"
  node_type                  = var.redis_node_type
  num_cache_clusters         = local.production ? 2 : 1
  automatic_failover_enabled = local.production
  multi_az_enabled           = local.production
  subnet_group_name          = aws_elasticache_subnet_group.main.name
  security_group_ids         = [aws_security_group.data.id]
  at_rest_encryption_enabled = true
  kms_key_id                 = aws_kms_key.data.arn
  transit_encryption_enabled = true
  auth_token                 = random_password.redis.result
}

# ---------- Audio bucket ----------

resource "aws_s3_bucket" "audio" {
  # checkov:skip=CKV_AWS_144: audio must stay in India; cross-region replication is a later decision (ap-south-2)
  # checkov:skip=CKV_AWS_18: S3 access logs would duplicate CloudTrail and keep object keys longer than the audio
  # checkov:skip=CKV2_AWS_62: no consumer for bucket events
  bucket = "${local.name}-audio-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "audio" {
  bucket                  = aws_s3_bucket.audio.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "audio" {
  bucket = aws_s3_bucket.audio.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audio" {
  bucket = aws_s3_bucket.audio.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.data.arn
    }
    bucket_key_enabled = true
  }
}

# Versioning protects against accidental overwrite; the lifecycle rule makes sure a DPDP deletion
# is final: deleted (noncurrent) versions are purged after 7 days.
resource "aws_s3_bucket_versioning" "audio" {
  bucket = aws_s3_bucket.audio.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_lifecycle_configuration" "audio" {
  bucket     = aws_s3_bucket.audio.id
  depends_on = [aws_s3_bucket_versioning.audio]
  rule {
    id     = "purge-deleted-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration { noncurrent_days = 7 }
    expiration { expired_object_delete_marker = true }
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
  }
}

resource "aws_s3_bucket_policy" "audio" {
  bucket = aws_s3_bucket.audio.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "TLSOnly"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.audio.arn, "${aws_s3_bucket.audio.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}
