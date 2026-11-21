# Online billing through Razorpay Subscriptions (src/lib/billing). Off until billing_driver = "razorpay".
# The key secret and webhook secret are filled in by hand from the Razorpay dashboard:
#   aws secretsmanager put-secret-value --secret-id interview-production/razorpay-key-secret --secret-string '...'
#   aws secretsmanager put-secret-value --secret-id interview-production/razorpay-webhook-secret --secret-string '...'
# Razorpay Dashboard → Webhooks: URL https://<domain>/api/billing/razorpay/webhook, the same secret,
# events subscription.* and invoice.paid.

resource "aws_secretsmanager_secret" "razorpay" {
  # checkov:skip=CKV2_AWS_57: rotated by hand in the Razorpay dashboard
  for_each   = var.billing_driver == "razorpay" ? toset(["razorpay-key-secret", "razorpay-webhook-secret"]) : toset([])
  name       = "${local.name}/${each.key}"
  kms_key_id = aws_kms_key.data.arn
}

locals {
  billing_env = var.billing_driver == "razorpay" ? [
    { name = "BILLING_DRIVER", value = "razorpay" },
    { name = "RAZORPAY_KEY_ID", value = var.razorpay_key_id },
  ] : []
  billing_secrets = var.billing_driver == "razorpay" ? [
    { name = "RAZORPAY_KEY_SECRET", valueFrom = aws_secretsmanager_secret.razorpay["razorpay-key-secret"].arn },
    { name = "RAZORPAY_WEBHOOK_SECRET", valueFrom = aws_secretsmanager_secret.razorpay["razorpay-webhook-secret"].arn },
  ] : []
}
