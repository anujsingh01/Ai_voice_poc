variable "env" {
  description = "staging or production"
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.env)
    error_message = "env must be staging or production."
  }
}

variable "region" {
  type    = string
  default = "ap-south-1"
}

variable "domain" {
  description = "Public host name, e.g. interview.example.com (staging: staging.interview.example.com)"
  type        = string
}

variable "certificate_arn" {
  description = "ACM certificate for var.domain in ap-south-1 (DNS-validated)"
  type        = string
}

variable "alarm_email" {
  description = "Who gets alarm emails (confirm the SNS subscription once)"
  type        = string
}

variable "image_tag" {
  description = "Container image tag to run (the git commit SHA built by CI)"
  type        = string
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "db_instance_class" {
  type = string
}

variable "db_allocated_storage_gb" {
  type    = number
  default = 50
}

variable "redis_node_type" {
  type = string
}

variable "web_desired_count" {
  type = number
}

variable "web_max_count" {
  type = number
}

variable "office_ip_cidrs" {
  description = "Public IPs of the offices running GPU transcription PCs; only these may call /api/worker/*"
  type        = list(string)
}

variable "monthly_budget_usd" {
  description = "AWS spend alarm (excludes OpenAI, which has its own limit)"
  type        = number
}

variable "email_from_name" {
  description = "Sender name on emails (the address is no-reply@<domain>)"
  type        = string
  default     = "Interviews"
}

variable "sms_driver" {
  description = "\"gupshup\" once DLT registration is done; empty keeps SMS queued (recruiters share links themselves)"
  type        = string
  default     = ""
  validation {
    condition     = contains(["", "gupshup"], var.sms_driver)
    error_message = "sms_driver must be \"\" or \"gupshup\"."
  }
}

variable "gupshup_user" {
  type    = string
  default = ""
}

variable "gupshup_sender_id" {
  description = "6-letter DLT sender id (header)"
  type        = string
  default     = ""
}

variable "gupshup_dlt_entity_id" {
  type    = string
  default = ""
}

variable "gupshup_dlt_templates" {
  description = "DLT template id per message kind: { invite = \"1107…\", deletion_notice = \"1107…\" }"
  type        = map(string)
  default     = {}
}

variable "billing_driver" {
  description = "\"razorpay\" to let tenant admins pay online; empty = plans assigned by staff only"
  type        = string
  default     = ""
  validation {
    condition     = contains(["", "razorpay"], var.billing_driver)
    error_message = "billing_driver must be \"\" or \"razorpay\"."
  }
}

variable "razorpay_key_id" {
  description = "Razorpay key id (rzp_live_… in production, rzp_test_… in staging); the secret goes in Secrets Manager"
  type        = string
  default     = ""
}
