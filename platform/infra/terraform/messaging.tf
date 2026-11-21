# Email through Amazon SES from the platform's own domain, and (once DLT registration is done) SMS through
# Gupshup. The messages worker sends both; see src/lib/messaging.ts.

resource "aws_sesv2_email_identity" "domain" {
  email_identity = var.domain
}

# Add these three CNAME records at the DNS provider so SES can sign mail (DKIM). New SES accounts are in
# the sandbox (only verified addresses receive mail) until production access is requested in the console.
output "ses_dkim_records" {
  value = [for t in aws_sesv2_email_identity.domain.dkim_signing_attributes[0].tokens : "${t}._domainkey.${var.domain} CNAME ${t}.dkim.amazonses.com"]
}

resource "aws_iam_role_policy" "task_ses" {
  role = aws_iam_role.task.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = ["ses:SendEmail"], Resource = [aws_sesv2_email_identity.domain.arn] }]
  })
}

# Filled in by hand once Gupshup is contracted:
#   aws secretsmanager put-secret-value --secret-id interview-production/gupshup-password --secret-string '...'
resource "aws_secretsmanager_secret" "gupshup" {
  # checkov:skip=CKV2_AWS_57: rotated by hand in the Gupshup console
  count      = var.sms_driver == "gupshup" ? 1 : 0
  name       = "${local.name}/gupshup-password"
  kms_key_id = aws_kms_key.data.arn
}

locals {
  messaging_env = concat(
    [
      { name = "EMAIL_DRIVER", value = "ses" },
      { name = "EMAIL_FROM", value = "${var.email_from_name} <no-reply@${var.domain}>" },
    ],
    var.sms_driver == "gupshup" ? [
      { name = "SMS_DRIVER", value = "gupshup" },
      { name = "GUPSHUP_USER", value = var.gupshup_user },
      { name = "GUPSHUP_SENDER_ID", value = var.gupshup_sender_id },
      { name = "GUPSHUP_DLT_ENTITY_ID", value = var.gupshup_dlt_entity_id },
      { name = "GUPSHUP_DLT_TEMPLATES", value = join(",", [for k, v in var.gupshup_dlt_templates : "${k}=${v}"]) },
    ] : [],
  )
  messaging_secrets = var.sms_driver == "gupshup" ? [{ name = "GUPSHUP_PASSWORD", valueFrom = aws_secretsmanager_secret.gupshup[0].arn }] : []
}
