# Alarms by email (SNS). The app-level rules (queue backlog, workers offline, job failures) come from
# /api/health, checked every minute by a CloudWatch Synthetics canary with the health token.

resource "aws_sns_topic" "alarms" {
  name              = "${local.name}-alarms"
  kms_master_key_id = "alias/aws/sns"
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

locals {
  alarms = {
    "web-5xx" = {
      description = "More than 20 server errors in 5 minutes"
      namespace   = "AWS/ApplicationELB", metric = "HTTPCode_Target_5XX_Count", stat = "Sum", threshold = 20
      dimensions  = { LoadBalancer = aws_lb.main.arn_suffix }
    }
    "web-unhealthy" = {
      description = "A web task is failing its health check"
      namespace   = "AWS/ApplicationELB", metric = "UnHealthyHostCount", stat = "Maximum", threshold = 0
      dimensions  = { LoadBalancer = aws_lb.main.arn_suffix, TargetGroup = aws_lb_target_group.web.arn_suffix }
    }
    "web-slow" = {
      description = "p95 response time over 2 s"
      namespace   = "AWS/ApplicationELB", metric = "TargetResponseTime", stat = "p95", threshold = 2
      dimensions  = { LoadBalancer = aws_lb.main.arn_suffix }
    }
    "db-cpu" = {
      description = "Database CPU over 80%"
      namespace   = "AWS/RDS", metric = "CPUUtilization", stat = "Average", threshold = 80
      dimensions  = { DBInstanceIdentifier = aws_db_instance.main.identifier }
    }
    "db-storage" = {
      description = "Database free storage under 10 GB"
      namespace   = "AWS/RDS", metric = "FreeStorageSpace", stat = "Minimum", threshold = 10737418240, lower = true
      dimensions  = { DBInstanceIdentifier = aws_db_instance.main.identifier }
    }
    "app-errors" = {
      description = "More than 10 logged errors in 5 minutes"
      namespace   = "Interview/${var.env}", metric = "AppErrors", stat = "Sum", threshold = 10
      dimensions  = {}
    }
    "health-check" = {
      description = "/api/health reports a critical alarm or is unreachable (see docs/operations.md)"
      namespace   = "CloudWatchSynthetics", metric = "SuccessPercent", stat = "Minimum", threshold = 100, lower = true
      dimensions  = { CanaryName = aws_synthetics_canary.health.name }
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "main" {
  for_each            = local.alarms
  alarm_name          = "${local.name}-${each.key}"
  alarm_description   = each.value.description
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  dimensions          = each.value.dimensions
  extended_statistic  = startswith(each.value.stat, "p") ? each.value.stat : null
  statistic           = startswith(each.value.stat, "p") ? null : each.value.stat
  period              = 300
  evaluation_periods  = 1
  threshold           = each.value.threshold
  comparison_operator = try(each.value.lower, false) ? "LessThanThreshold" : "GreaterThanThreshold"
  treat_missing_data  = each.key == "health-check" ? "breaching" : "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}

# Error lines from the app's JSON logs (src/lib/log.ts) become a metric.
resource "aws_cloudwatch_log_metric_filter" "errors" {
  for_each       = toset(["web", "scoring", "maintenance", "messages"])
  name           = "${local.name}-${each.key}-errors"
  log_group_name = aws_cloudwatch_log_group.app[each.key].name
  pattern        = "{ $.level = \"error\" }"
  metric_transformation {
    name      = "AppErrors"
    namespace = "Interview/${var.env}"
    value     = "1"
  }
}

# ---------- Health canary ----------

resource "aws_s3_bucket" "canary" {
  # checkov:skip=CKV_AWS_18: canary screenshots/logs only, kept 2-14 days
  # checkov:skip=CKV_AWS_21: no versioning needed for throwaway canary artifacts
  # checkov:skip=CKV_AWS_144: no replication needed for throwaway canary artifacts
  # checkov:skip=CKV2_AWS_62: no consumer for bucket events
  # checkov:skip=CKV2_AWS_61: Synthetics retention settings expire the artifacts
  bucket        = "${local.name}-canary-${data.aws_caller_identity.current.account_id}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "canary" {
  bucket                  = aws_s3_bucket.canary.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "canary" {
  bucket = aws_s3_bucket.canary.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.data.arn
    }
  }
}

resource "aws_iam_role" "canary" {
  name = "${local.name}-canary"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "lambda.amazonaws.com" } }]
  })
}

resource "aws_iam_role_policy" "canary" {
  role = aws_iam_role.canary.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:PutObject", "s3:GetBucketLocation"], Resource = [aws_s3_bucket.canary.arn, "${aws_s3_bucket.canary.arn}/*"] },
      { Effect = "Allow", Action = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"], Resource = "*" },
      { Effect = "Allow", Action = ["cloudwatch:PutMetricData"], Resource = "*", Condition = { StringEquals = { "cloudwatch:namespace" = "CloudWatchSynthetics" } } },
      { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = [aws_secretsmanager_secret.generated["health-token"].arn] },
      { Effect = "Allow", Action = ["kms:Decrypt"], Resource = [aws_kms_key.data.arn] },
    ]
  })
}

data "archive_file" "canary" {
  type        = "zip"
  output_path = "${path.module}/.build/canary.zip"
  source {
    filename = "nodejs/node_modules/health.js"
    content  = <<-JS
      const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
      exports.handler = async () => {
        const sm = new SecretsManagerClient({});
        const token = (await sm.send(new GetSecretValueCommand({ SecretId: '${aws_secretsmanager_secret.generated["health-token"].arn}' }))).SecretString;
        const res = await fetch('https://${var.domain}/api/health', { headers: { Authorization: 'Bearer ' + token } });
        const body = await res.json();
        for (const a of body.alarms ?? []) console.log(a.level + ' ' + a.code + ': ' + a.message);
        if (res.status !== 200 || body.status === 'down') throw new Error('health ' + body.status);
      };
    JS
  }
}

resource "aws_synthetics_canary" "health" {
  name                 = substr("${var.env}-health", 0, 21)
  artifact_s3_location = "s3://${aws_s3_bucket.canary.bucket}/"
  execution_role_arn   = aws_iam_role.canary.arn
  handler              = "health.handler"
  zip_file             = data.archive_file.canary.output_path
  runtime_version      = "syn-nodejs-puppeteer-9.1"
  start_canary         = true
  schedule { expression = "rate(1 minute)" }
  success_retention_period = 2
  failure_retention_period = 14
}

# ---------- Spend ----------

resource "aws_budgets_budget" "monthly" {
  name         = "${local.name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"
  cost_filter {
    name   = "TagKeyValue"
    values = ["user:Environment$${var.env}"]
  }
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alarm_email]
  }
}
